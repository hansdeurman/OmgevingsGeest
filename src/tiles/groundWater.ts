import type { RGB } from '../rendering/palette';
import type { RiverState } from '../water/hydroWorld';
import { WETNESS } from '../water/wetness';
import { frameCentre, type GridFrame } from './geometry';
import { blendField, hexBlend, sampleField, type HexBlend } from './hexField';
import { createRaster, type Raster } from './raster';
import { paintRivers, riverPaths } from './riverPaint';
import { gradeGround, groundDetail, type GroundDetail } from './wetGround';

/**
 * The map's ground as the water has it now: graded by how wet each hex is
 * (from parched to under water) and with its rivers painted in, from the
 * ground as painted at normal wetness. What stays the same from step to
 * step (how hexes blend, the ground's detail) is worked out once per map.
 */
export interface WetLayer {
  cols: number;
  rows: number;
  frame: GridFrame;
  size: number;
  seed: number;
  blend: HexBlend;
  detail: GroundDetail;
  /** Pixels left as painted: open water and off the map. */
  keep: Uint8Array;
}

/** The water's state per hex: how wet (WETNESS scale), its rivers, the ground's height (steps). */
export interface GroundWaterState {
  wetness: ArrayLike<number>;
  river?: RiverState;
  ground: ArrayLike<number>;
}

export interface GroundWaterOptions {
  /** The wettest a hex may look (its water drawn apart, as a high lake); no cap if absent. */
  cap?: (i: number) => number;
  /** The water's own colour at a pixel. */
  water: (x: number, y: number) => RGB;
}

/** A river shows where its bed carried at least this much (steps per step)… */
export const RIVER_BED = 0.04;
/** …except where water stands over it this wet: the river runs into the lake. */
const UNDER_WATER = 4.5;

/** The ground's detail is the same on every map. */
let detailCache: GroundDetail | undefined;

export function wetLayer(cols: number, rows: number, frame: GridFrame, size: number, keep: Uint8Array, seed: number): WetLayer {
  detailCache ??= groundDetail(1);
  return { cols, rows, frame, size, seed, blend: hexBlend(cols, rows, frame, size), detail: detailCache, keep };
}

/**
 * `base` graded and with its rivers, as a new raster squashed vertically by
 * `squash` (the projected map, drawn as it is), and which of its pixels the
 * rivers cover.
 */
export function paintGroundWater(base: Raster, layer: WetLayer, state: GroundWaterState, opts: GroundWaterOptions, squash = 1): { ground: Raster; river: Uint8Array } {
  const { cols, frame, size, seed, blend, keep } = layer;
  const wetness = opts.cap ? Float32Array.from(state.wetness, (w, i) => Math.min(w, opts.cap!(i))) : state.wetness;
  const field = blendField(blend, wetness);
  const ground = createRaster(base.width, Math.ceil(base.height * squash));
  gradeGround(base, ground, blend, field, keep, layer.detail, opts.water, squash);
  const { river } = state;
  if (!river) return { ground, river: new Uint8Array(ground.width * ground.height) };
  const unsquash = (py: number) => Math.min(base.height - 1, Math.floor((py + 0.5) / squash));
  const isRiver = (i: number) => river.bed[i] >= RIVER_BED && state.wetness[i] < WETNESS.flooded;
  const mask = paintRivers(ground, riverPaths(river.down, river.bed, isRiver), {
    centre: (i) => frameCentre(i % cols, Math.floor(i / cols), size, frame),
    size,
    seed,
    bed: river.bed,
    flow: river.flow,
    ground: state.ground,
    keep: (x, py) => keep[unsquash(py) * base.width + x] === 1 || sampleField(blend, field, x + 0.5, unsquash(py) + 0.5) >= UNDER_WATER,
    water: (x, py) => opts.water(x, unsquash(py)),
    squash,
  });
  return { ground, river: mask };
}
