import { smoothstep } from '../math/scalar';

/**
 * Mountain ranges as lines across the land: a range winds from one end to
 * the other, its crest rising from low ends to its height in the middle,
 * and it stands broad or narrow along the way. The land at a place rises
 * with the nearest stretch of crest, falling away across the range's
 * breadth into low, broad foothills. Distances in hex spacings.
 */
export interface Vec {
  x: number;
  y: number;
}

/** A point on a range's crest: how high it stands above the land, and how broad the range is there. */
export interface RidgePoint extends Vec {
  high: number;
  broad: number;
}

export interface RangeShape {
  /** How far its middle bends off the straight line, to the left (below 0: the right). */
  bend: number;
  /** How far it wavers off its bend, here and there. */
  waver: number;
  /** How high its crest stands, at its highest. */
  high: number;
  /** How broad it is, at its narrowest and broadest. */
  broad: readonly [number, number];
  /** Smooth noise (0–1) along it: `s` picks the stream, `t` the share of the way. */
  noise: (s: number, t: number) => number;
  /** Points along it. */
  samples?: number;
}

/** Share of a range's height in its foothills, and how many times its breadth they reach. */
const FOOTHILLS = { share: 0.25, wide: 2.5 };
/** Share of the way over which a range rises from its ends. */
const ENDS = 0.18;

/** A winding range from `from` to `to`. */
export function rangeLine(from: Vec, to: Vec, shape: RangeShape): RidgePoint[] {
  const [dx, dy] = [to.x - from.x, to.y - from.y];
  const length = Math.hypot(dx, dy) || 1;
  const [nx, ny] = [-dy / length, dx / length];
  const samples = shape.samples ?? Math.max(8, Math.ceil(length * 3));
  return Array.from({ length: samples + 1 }, (_, k) => {
    const t = k / samples;
    const off = shape.bend * Math.sin(Math.PI * t) + shape.waver * 2 * (shape.noise(0, t) - 0.5);
    const rise = smoothstep(0, ENDS, t) * smoothstep(1, 1 - ENDS, t);
    return {
      x: from.x + dx * t + nx * off,
      y: from.y + dy * t + ny * off,
      high: shape.high * rise * (0.8 + 0.4 * shape.noise(1, t)),
      broad: shape.broad[0] + (shape.broad[1] - shape.broad[0]) * shape.noise(2, t),
    };
  });
}

/** How high the ranges stand at (x, y): the highest of what each stretch of crest raises there. */
export function rangeHeight(lines: readonly (readonly RidgePoint[])[], x: number, y: number): number {
  let most = 0;
  for (const line of lines)
    for (const p of line) {
      const d2 = (x - p.x) ** 2 + (y - p.y) ** 2;
      const h = p.high * ((1 - FOOTHILLS.share) * Math.exp(-d2 / p.broad ** 2) + FOOTHILLS.share * Math.exp(-d2 / (FOOTHILLS.wide * p.broad) ** 2));
      if (h > most) most = h;
    }
  return most;
}

/** The point of `line` nearest (x, y), and how far off it lies. */
export function nearestOn(line: readonly RidgePoint[], x: number, y: number): { point: RidgePoint; distance: number } {
  let [point, distance] = [line[0], Infinity];
  for (const p of line) {
    const d = Math.hypot(x - p.x, y - p.y);
    if (d < distance) [point, distance] = [p, d];
  }
  return { point, distance };
}

/** A basin's hollow (a cirque): how deep its bottom lies below its floor and its lip above it (steps), where the lip is and how far out it eases into the land (shares of its radius). */
export const CIRQUE = { depth: 1, lip: 0.4, edge: 1.2, ease: 2.8 } as const;

/**
 * Land `e` with a cirque worn into it whose floor is at `floor`, at `d`
 * (shares of its radius) from its middle: a bowl under a broad lip, the lip
 * easing into the land around over a wide band, so the ground stays gentle,
 * and `peak` standing in it.
 */
export function cirque(e: number, d: number, floor: number, peak = 0): number {
  const lip = floor + CIRQUE.lip;
  const bowl = d < CIRQUE.edge ? floor - CIRQUE.depth + (lip - floor + CIRQUE.depth) * (d / CIRQUE.edge) ** 2 + peak : lip;
  return bowl + (e - bowl) * smoothstep(CIRQUE.edge, CIRQUE.ease, d);
}
