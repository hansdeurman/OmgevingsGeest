import { EDGE_VECTORS, hexTopology, isInner, opposite, pipeSteps, pipeTarget, type HexTopology } from './hexTopology';
import { temperature } from './retention';

/**
 * The air over a hex map: per hex the water vapour it carries and the cloud
 * it has condensed into, both moved by the wind (nothing lost on the way,
 * only over the map's edge, while air from beyond the edge the wind comes
 * from brings sea air in). Warm air holds more vapour than cold air, so air
 * the wind drives up a mountainside cools, its vapour condenses into cloud
 * and heavy clouds rain (or snow) on the slope; behind the ridge the air
 * comes down, warms and its clouds dissolve: a rain shadow. The sea moistens
 * the air over it; what evaporates on land (`rise`) is taken up each step.
 * Water in steps, as on the ground; wind in hex spacings per step.
 */
export interface Air {
  topo: HexTopology;
  /** The ground the air lies on (the sea's surface: 0), which sets how warm it is. */
  floor: Float32Array;
  sea: Uint8Array;
  vapour: Float32Array;
  cloud: Float32Array;
  /** Rain or snow that fell from each hex's clouds in the last step. */
  fall: Float32Array;
  /** Water that rose from each hex since the last step: added to its vapour. */
  rise: Float32Array;
  /** Scratch for carrying. */
  next: Float32Array;
}

/** The weather the air moves in: the season's warmth (-1 winter … 1 summer), the wind, and where weather systems lift the air (0–1 per hex). */
export interface Sky {
  warmth: number;
  wind: { x: number; y: number };
  lift?: ArrayLike<number>;
}

export interface AirParams {
  /** Share of vapour beyond what the air holds that condenses per step… */
  condense: number;
  /** …and of what it could still hold that its cloud gives back as vapour. */
  dissolve: number;
  /** Cloud (steps) above which it rains, and the share of the rest that falls per step. */
  rainFrom: number;
  rainRate: number;
  /** How humid the sea makes the air over it, and the share of the way there per step. */
  seaHumidity: number;
  seaRate: number;
  /** How much each step of rising ground holds the wind back. */
  block: number;
  /** Share less air holds where weather systems lift it fully. */
  lift: number;
}

export const DEFAULT_AIR: AirParams = {
  condense: 0.5,
  dissolve: 0.3,
  rainFrom: 0.06,
  rainRate: 0.15,
  seaHumidity: 0.85,
  seaRate: 0.1,
  block: 0.1,
  lift: 0.2,
};

/** Vapour (steps) saturated air holds at 0°, and how much more per degree warmer. */
const SATURATION = { at0: 0.35, perDegree: 0.1 };

/** The most vapour air this warm (°) holds. */
export const saturation = (t: number) => SATURATION.at0 * Math.exp(SATURATION.perDegree * t);

/** Of a hex's air, the share that leaves across one edge per step for each hex spacing the wind blows that way: edge length over area. */
const EDGE_SHARE = 2 / 3;
/** At most this share of a hex's air leaves it per step, however strong the wind. */
const MOST_LEAVING = 0.9;

export function createAir(cols: number, rows: number, ground: ArrayLike<number>, sea: Uint8Array): Air {
  const n = cols * rows;
  return {
    topo: hexTopology(cols, rows, 6),
    floor: Float32Array.from(ground, (g) => Math.max(0, g)),
    sea,
    vapour: new Float32Array(n),
    cloud: new Float32Array(n),
    fall: new Float32Array(n),
    rise: new Float32Array(n),
    next: new Float32Array(n),
  };
}

/** Air as humid as the sea makes it everywhere, without clouds: a start that needs no spin-up. */
export function humidAir(air: Air, warmth: number, p: AirParams = DEFAULT_AIR): void {
  air.floor.forEach((h, i) => (air.vapour[i] = p.seaHumidity * Math.min(saturation(temperature(0, warmth)), saturation(temperature(h, warmth)))));
  air.cloud.fill(0);
}

/**
 * Move `q` (vapour or cloud, per hex) one step with the `wind`, in place: each hex
 * sends a share across every edge the wind blows through, less uphill;
 * what crosses the map's edge is gone, and through edges facing the wind
 * air carrying `ambient` comes in.
 */
export function carry(air: Air, q: Float32Array, wind: { x: number; y: number }, ambient: number, p: AirParams = DEFAULT_AIR): void {
  const { topo, floor, next } = air;
  const { cols, rows } = topo;
  const out = EDGE_VECTORS.map(([x, y]) => EDGE_SHARE * Math.max(0, wind.x * x + wind.y * y));
  const total = out.reduce((a, b) => a + b, 0);
  if (total > MOST_LEAVING) out.forEach((o, d) => (out[d] = (o * MOST_LEAVING) / total));
  const steps = pipeSteps(topo);
  next.fill(0);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      const inner = isInner(topo, row, col);
      let left = q[i];
      for (let d = 0; d < 6; d++) {
        const j = inner ? i + steps[(row & 1) * 6 + d] : pipeTarget(topo, i, d);
        if (j < 0) {
          next[i] += out[opposite(d)] * ambient; // air from beyond the edge
          left -= out[d] * q[i];
          continue;
        }
        if (!out[d]) continue;
        const moved = (out[d] * q[i]) / (1 + p.block * Math.max(0, floor[j] - floor[i]));
        next[j] += moved;
        left -= moved;
      }
      next[i] += left;
    }
  }
  q.set(next);
}

/** One step of the air, in place: the sea moistens it, what rose is taken up, the wind carries it, vapour and cloud trade places, heavy clouds fall (into `fall`). */
export function airStep(air: Air, sky: Sky, p: AirParams = DEFAULT_AIR): void {
  const { floor, sea, vapour, cloud, fall, rise } = air;
  const { wind } = sky;
  const seaAir = p.seaHumidity * saturation(temperature(0, sky.warmth));
  for (let i = 0; i < vapour.length; i++) {
    vapour[i] += rise[i] + (sea[i] ? p.seaRate * Math.max(0, seaAir - vapour[i]) : 0);
    rise[i] = 0;
  }
  carry(air, vapour, wind, seaAir, p);
  carry(air, cloud, wind, 0, p);
  for (let i = 0; i < vapour.length; i++) {
    const holds = saturation(temperature(floor[i], sky.warmth)) * (1 - p.lift * (sky.lift?.[i] ?? 0));
    const beyond = vapour[i] - holds;
    const trade = beyond > 0 ? p.condense * beyond : -Math.min(cloud[i], p.dissolve * -beyond);
    vapour[i] -= trade;
    cloud[i] += trade;
    fall[i] = cloud[i] > p.rainFrom ? p.rainRate * (cloud[i] - p.rainFrom) : 0;
    cloud[i] -= fall[i];
  }
}
