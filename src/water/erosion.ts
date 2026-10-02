import { smoothstep } from '../math/scalar';
import type { HexTopology } from './hexTopology';

/**
 * Running water wearing the land down. Water flowing over falling ground can
 * carry sediment, the more the faster it falls; it cuts ground away while it
 * carries less than it could (hard rock gives way slower than soft ground),
 * carries what it took along with the flow, and lays it down where it slows,
 * in a lake or on a flat. Ground too steep to stand slumps into its lower
 * neighbour, so a waterfall eats its way back and cliffs become slopes over
 * time. Nothing is lost but what the sea swallows. Works in place.
 */
export interface ErosionParams {
  /** Sediment water can carry per unit of flow times ground drop. */
  capacity: number;
  /** Share of the missing load cut from soft ground per step. */
  erosion: number;
  /** Share of the excess load laid down per step. */
  deposition: number;
  /** Ground drop per hex spacing that still stands; steeper ground slumps… */
  talus: number;
  /** …this share of the excess per step. */
  slump: number;
}

export const DEFAULT_EROSION: ErosionParams = { capacity: 0.5, erosion: 0.003, deposition: 0.2, talus: 2.5, slump: 0.0002 };

/** How hard a hex's ground is to wear away (0 soft … 1 unbreakable): bare rock high up, then ground held by roots, then sand. */
export function hardnessOf(grass: number, trees: number, elevation: number): number {
  const rock = smoothstep(3.5, 6.5, elevation);
  const roots = Math.min(1, 0.08 * grass + 0.12 * trees);
  return Math.min(0.95, 0.15 + 0.65 * rock + 0.35 * roots * (1 - rock));
}

/** Falling faster than this (steps per hex spacing) wears no harder: a waterfall is a waterfall. */
const MAX_DROP = 1.5;
/** Water this shallow (steps) counts as dry: it drops whatever it carries. */
const DRY = 1e-4;

/** One step of erosion after a step of flow: `ground` and `sediment` change; `flux` and `depth` are read. */
export function erodeStep(
  topo: HexTopology,
  ground: Float32Array,
  depth: Float32Array,
  flux: Float32Array,
  sediment: Float32Array,
  hardness: Float32Array,
  sink: Uint8Array,
  params: Partial<ErosionParams> = {},
): void {
  const { capacity, erosion, deposition, talus, slump } = { ...DEFAULT_EROSION, ...params };
  const { cols, rows, n, dirs, dc, dr, length } = topo;
  const target = (i: number, d: number) => {
    const row = Math.floor(i / cols);
    const r = row + dr[d];
    const c = i - row * cols + dc[(row & 1) * dirs + d];
    return r < 0 || r >= rows || c < 0 || c >= cols ? -1 : r * cols + c;
  };

  // Cut or lay down, by how much the water here could carry.
  for (let i = 0; i < n; i++) {
    if (sink[i]) continue;
    let power = 0;
    let lowest = ground[i];
    for (let d = 0; d < dirs; d++) {
      const f = flux[i * dirs + d];
      if (f <= 0) continue;
      const j = target(i, d);
      if (j < 0) continue;
      const drop = Math.min(ground[i] - ground[j], MAX_DROP * length[d]);
      if (drop > 0) power += (f * drop) / length[d];
      if (ground[j] < lowest) lowest = ground[j];
    }
    const load = depth[i] > DRY ? capacity * power : 0;
    if (sediment[i] < load) {
      // Never below where the water runs on to: no pits.
      const cut = Math.min(erosion * (1 - hardness[i]) * (load - sediment[i]), Math.max(0, (ground[i] - lowest) * 0.5));
      ground[i] -= cut;
      sediment[i] += cut;
    } else {
      const laid = depth[i] > DRY ? deposition * (sediment[i] - load) : sediment[i];
      ground[i] += laid;
      sediment[i] -= laid;
    }
  }

  // Carry the load along with the water: each hex sends the share of its water that leaves it.
  const moved = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!sediment[i]) continue;
    let out = 0;
    for (let d = 0; d < dirs; d++) out += flux[i * dirs + d];
    if (out <= 0) {
      moved[i] += sediment[i];
      continue;
    }
    const leaves = Math.min(1, out / Math.max(depth[i] + out, DRY));
    moved[i] += sediment[i] * (1 - leaves);
    for (let d = 0; d < dirs; d++) {
      const f = flux[i * dirs + d];
      const j = f > 0 ? target(i, d) : -1;
      if (j >= 0) moved[j] += (sediment[i] * leaves * f) / out;
      else if (f > 0) moved[i] += (sediment[i] * leaves * f) / out;
    }
  }
  for (let i = 0; i < n; i++) sediment[i] = sink[i] ? 0 : moved[i];

  // Ground too steep to stand slumps into its lower neighbours.
  const slide = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (sink[i]) continue; // the sea and the map's edge take, but give nothing
    for (let d = 0; d < 6; d++) {
      const j = target(i, d);
      if (j < 0) continue;
      const excess = ground[i] - ground[j] - talus;
      if (excess <= 0) continue;
      const m = (slump * excess) / 2;
      slide[i] -= m;
      slide[j] += m;
    }
  }
  for (let i = 0; i < n; i++) if (!sink[i]) ground[i] += slide[i];
}
