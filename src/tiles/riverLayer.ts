import { clamp } from '../math/scalar';
import type { Pixel } from '../math/hex';
import { opposite, pipeTarget, type HexTopology } from '../water/hexTopology';
import { frameCentre, type GridFrame } from './geometry';

/**
 * Rivers as the water model has them now. Through every hex water runs
 * through, a curve from where it comes in (halfway to the hex upstream) past
 * the hex's middle to where it goes out (halfway to the hex downstream), so
 * neighbouring hexes' curves meet and the river bends instead of zigzagging.
 * Water spread over many pipes on a slope is one river along its main ways;
 * a real fork is two. Water moving about inside a lake is left to the lake.
 */
export interface RiverSegment {
  /** A quadratic curve, in frame pixels. */
  from: Pixel;
  via: Pixel;
  to: Pixel;
  /** Width in frame pixels. */
  width: number;
  /** How deep (steps) the water has cut into the hex's ground: the deeper, the wider and darker its gully. */
  cut: number;
}

/** Water through a hex (steps per step) from which it may be a river… */
const MIN_FLOW = 0.006;
/** …if it carries this many times as much as the hexes around it on average: where water gathers, not a sheet over a slope. */
const GATHERS = 1.6;
/** Downstream of a river, a hex carrying this share of the river's least flow still continues it. */
const CONTINUES = 0.3;
/** A way in or out carrying less than this share of the hex's water is not a branch of its river. */
const BRANCH = 0.3;
/** River width per square root of flow, and its bounds, in hex radii. */
const WIDTH = { perRootFlow: 0.6, min: 0.07, max: 0.45 };
/** Water this deep (steps) on both ends of a pipe is lake, not river. */
const LAKE = 0.3;

/** Per hex: net flow out through each pipe (negative: in), and how much flows in and out in all. */
function netFlows(topo: HexTopology, flux: Float32Array, depth: ArrayLike<number>) {
  const { n, dirs } = topo;
  const flows = new Float32Array(n * dirs);
  const [into, out] = [new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    for (let d = 0; d < dirs; d++) {
      const j = pipeTarget(topo, i, d);
      const f = j < 0 || (depth[i] > LAKE && depth[j] > LAKE) ? 0 : flux[i * dirs + d] - flux[j * dirs + opposite(d)];
      flows[i * dirs + d] = f;
      if (f > 0) out[i] += f;
      else into[i] -= f;
    }
  }
  const through = into.map((v, i) => Math.max(v, out[i]));
  return { flows, into, out, through };
}

type Flows = ReturnType<typeof netFlows>;

/** Is pipe d of hex i one of its river's ways out (sign 1) or in (sign -1): carrying a fair share of what leaves or enters? */
const isWay = ({ flows, into, out }: Flows, dirs: number, i: number, d: number, sign: 1 | -1) =>
  sign * flows[i * dirs + d] >= BRANCH * (sign > 0 ? out[i] : into[i]) && sign * flows[i * dirs + d] > 0;

/**
 * Which hexes carry a river: those where water gathers (well above what the
 * hexes around them carry), and downstream of them every hex the river runs
 * on into while it still carries a fair share, so it does not break off.
 */
function riverHexes(topo: HexTopology, f: Flows): Uint8Array {
  const { n, dirs } = topo;
  const river = new Uint8Array(n);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (f.through[i] < MIN_FLOW) continue;
    let sum = 0;
    let k = 0;
    for (let d = 0; d < 6; d++) {
      const j = pipeTarget(topo, i, d);
      if (j < 0) continue;
      sum += f.through[j];
      k++;
    }
    if (f.through[i] < GATHERS * (sum / Math.max(1, k))) continue;
    river[i] = 1;
    queue.push(i);
  }
  while (queue.length) {
    const i = queue.pop()!;
    for (let d = 0; d < dirs; d++) {
      if (!isWay(f, dirs, i, d, 1)) continue;
      const j = pipeTarget(topo, i, d);
      if (river[j] || f.through[j] < CONTINUES * MIN_FLOW) continue;
      river[j] = 1;
      queue.push(j);
    }
  }
  return river;
}

export function riverSegments(
  topo: HexTopology,
  flux: Float32Array,
  depth: ArrayLike<number>,
  frame: GridFrame,
  size: number,
  cut: ArrayLike<number> = [],
): RiverSegment[] {
  const { n, dirs, cols } = topo;
  const centre = (i: number) => frameCentre(i % cols, Math.floor(i / cols), size, frame);
  const f = netFlows(topo, flux, depth);
  const river = riverHexes(topo, f);
  const segments: RiverSegment[] = [];
  for (let i = 0; i < n; i++) {
    if (!river[i]) continue;
    const c = centre(i);
    const halfway = (d: number) => {
      const o = centre(pipeTarget(topo, i, d));
      return { x: (c.x + o.x) / 2, y: (c.y + o.y) / 2 };
    };
    // Ways in only from hexes that are river too: a river does not start halfway from a dry hex.
    const ways = (sign: 1 | -1) => Array.from({ length: dirs }, (_, d) => d).filter((d) => isWay(f, dirs, i, d, sign) && (sign > 0 || river[pipeTarget(topo, i, d)]));
    const [ins, outs] = [ways(-1).map(halfway), ways(1).map(halfway)];
    const width = clamp(WIDTH.perRootFlow * Math.sqrt(f.through[i]), WIDTH.min, WIDTH.max) * size;
    for (const from of ins.length ? ins : [c]) for (const to of outs.length ? outs : [c]) segments.push({ from, via: c, to, width, cut: Math.max(0, cut[i] ?? 0) });
  }
  return segments;
}
