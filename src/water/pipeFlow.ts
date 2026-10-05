import { opposite, type HexTopology } from './hexTopology';

/**
 * Water flowing between hexes through pipes that remember how hard they
 * flow ("virtual pipes"): each step a pipe's flow speeds up with the drop of
 * the water surface along it and slows down by friction, so water keeps
 * running after a push, rivers keep flowing, and a lake that gets water on
 * one side levels out over many steps instead of at once. A hex never gives
 * more than it holds. Corner pipes pass water only above the lower of the two
 * hexes beside the corner, so a ridge holds even diagonally.
 *
 * Everything works in place on flat typed arrays, cheap enough for very
 * large maps. Heights and water are in terrace steps.
 */
export interface FlowParams {
  /** How much a pipe's flow speeds up per step of surface drop along it. */
  gravity: number;
  /** Share of its flow a pipe keeps from one step to the next. */
  damping: number;
}

export const DEFAULT_FLOW: FlowParams = { gravity: 0.04, damping: 0.97 };

/** One step of flow. `flux` (per pipe) and `depth` (per hex) are updated; sinks (`sink[i]`) swallow their water: how much is returned. */
export function flowStep(
  topo: HexTopology,
  ground: Float32Array,
  depth: Float32Array,
  flux: Float32Array,
  sink: Uint8Array,
  { gravity, damping }: FlowParams = DEFAULT_FLOW,
): number {
  const { cols, rows, n, dirs, dc, dr, length } = topo;
  const surface = scratch(n);
  for (let i = 0; i < n; i++) surface[i] = ground[i] + depth[i];
  // Pipes as index steps, per row parity: away from the map's edge a pipe's target is just i + step.
  const step = Int32Array.from({ length: 2 * dirs }, (_, k) => dr[k % dirs] * cols + dc[k]);
  const back = BACK[dirs];
  const pull = Float32Array.from(length, (l) => gravity / l);
  const target = (row: number, col: number, d: number) => {
    const r = row + dr[d];
    const c = col + dc[(row & 1) * dirs + d];
    return r < 0 || r >= rows || c < 0 || c >= cols ? -1 : r * cols + c;
  };
  const inner = (row: number, col: number) => row >= 2 && row < rows - 2 && col >= 2 && col < cols - 2;
  // Speed every pipe up (or down) by the drop along it; no hex gives more than it holds.
  for (let row = 0, i = 0; row < rows; row++) {
    const steps = (row & 1) * dirs;
    for (let col = 0; col < cols; col++, i++) {
      const fast = inner(row, col);
      const si = surface[i];
      let out = 0;
      for (let d = 0; d < dirs; d++) {
        const p = i * dirs + d;
        const j = fast ? i + step[steps + d] : target(row, col, d);
        if (j < 0) {
          flux[p] = 0;
          continue;
        }
        let sj = surface[j];
        if (d >= 6) {
          // A corner pipe: the water has to pass between the two hexes beside the corner (directions d - 6 and d - 5).
          const a = fast ? i + step[steps + d - 6] : target(row, col, d - 6);
          const b = fast ? i + step[steps + ((d - 5) % 6)] : target(row, col, (d - 5) % 6);
          const pass = a < 0 || b < 0 ? Infinity : Math.min(surface[a], surface[b]);
          if (pass > sj) sj = pass;
        }
        const f = flux[p] * damping + pull[d] * (si - sj);
        flux[p] = f > 0 ? f : 0;
        out += flux[p];
      }
      if (out > depth[i]) {
        const k = out > 0 ? depth[i] / out : 0;
        for (let p = i * dirs; p < (i + 1) * dirs; p++) flux[p] *= k;
      }
    }
  }
  // Move the water: in through the pipes pointing here, out through this hex's own.
  let swallowed = 0;
  for (let row = 0, i = 0; row < rows; row++) {
    const steps = (row & 1) * dirs;
    for (let col = 0; col < cols; col++, i++) {
      const fast = inner(row, col);
      let change = 0;
      for (let d = 0; d < dirs; d++) {
        const j = fast ? i + step[steps + d] : target(row, col, d);
        if (j >= 0) change += flux[j * dirs + back[d]] - flux[i * dirs + d];
      }
      const next = depth[i] + change;
      if (sink[i] && next > 0) swallowed += next;
      depth[i] = sink[i] || next < 0 ? 0 : next;
    }
  }
  return swallowed;
}

/** A reused buffer of at least `n` floats: a step allocates nothing. */
let buffer = new Float32Array(0);
const scratch = (n: number) => (buffer.length >= n ? buffer : (buffer = new Float32Array(n)));

/** The opposite of every direction, for 6 and 12 directions. */
const BACK = { 6: Int8Array.from({ length: 6 }, (_, d) => opposite(d)), 12: Int8Array.from({ length: 12 }, (_, d) => opposite(d)) };

/** How much water leaves hex `i` per step. */
export function outflow(topo: HexTopology, flux: Float32Array, i: number): number {
  let out = 0;
  for (let p = i * topo.dirs; p < (i + 1) * topo.dirs; p++) out += flux[p];
  return out;
}
