import { smoothstep } from '../math/scalar';
import type { RGB } from '../rendering/palette';
import type { RiverState } from '../water/hydroWorld';
import { WETNESS } from '../water/wetness';
import { ART_HEX, frameCentre, type GridFrame } from './geometry';
import { blendField, hexBlend, sampleField, type HexBlend } from './hexField';
import { createRaster, type Raster } from './raster';
import { paintRiverLines, riverLines, riverPaths, type RiverLine } from './riverPaint';
import { strokeAlong } from './rivers';
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

/**
 * The water's look now, as data to paint from (here, or on the GPU): how
 * wet the ground is (blended, at the layer's grid points), the rivers as
 * lines, and which pixels of the projected map the rivers' beds cover.
 */
export interface WaterLook {
  field: Float32Array;
  lines: RiverLine[];
  river: RiverMask;
}

/** Which spots of the projected map the rivers' beds cover, in square cells: fine enough to keep props out of them. */
export interface RiverMask {
  /** Cell side, and cells per row, of the projected map. */
  cell: number;
  cols: number;
  data: Uint8Array;
}

const RIVER_CELL = 4;

/** Whether the rivers cover pixel (x, y) of the projected map. */
export const onRiver = (m: RiverMask, x: number, y: number) => m.data[Math.floor(y / m.cell) * m.cols + Math.floor(x / m.cell)] === 1;

/** The cells of a `width` x `height` projected map that river `lines` (frame px) cover. */
function riverMask(lines: readonly RiverLine[], width: number, height: number, squash: number): RiverMask {
  const [cols, rows] = [Math.ceil(width / RIVER_CELL), Math.ceil(height / RIVER_CELL)];
  const data = new Uint8Array(cols * rows);
  for (const { points, bed } of lines) {
    const scaled = points.map((p) => ({ x: p.x / RIVER_CELL, y: p.y / RIVER_CELL }));
    for (const i of strokeAlong(scaled, bed.map((w) => w / RIVER_CELL), cols, rows, squash).keys()) data[i] = 1;
  }
  return { cell: RIVER_CELL, cols, data };
}

/** A river shows where its bed carried at least this much (steps per step)… */
export const RIVER_BED = 0.04;
/** …in the mountains, where rivers spring from rain and melt, already a stream at this share of it… */
const STREAM = { share: 0.25, from: 3, full: 6 };
export const riverBedAt = (ground: number) => RIVER_BED * (1 - (1 - STREAM.share) * smoothstep(STREAM.from, STREAM.full, ground));
/** …except where water stands over it this wet: the river runs into the lake. */
export const UNDER_WATER = 4.5;

/** The ground's detail is the same on every map drawn at one hex size. */
const details = new Map<number, GroundDetail>();
const detailFor = (size: number) => details.get(size) ?? details.set(size, groundDetail(1, 512, size / ART_HEX)).get(size)!;

/** `detail` is the ground's detail if it was made already (in a worker); made here, once per hex size, if absent. */
export function wetLayer(cols: number, rows: number, frame: GridFrame, size: number, keep: Uint8Array, seed: number, detail?: GroundDetail): WetLayer {
  return { cols, rows, frame, size, seed, blend: hexBlend(cols, rows, frame, size), detail: detail ?? detailFor(size), keep };
}

/** The look of the water in `state` on a map whose ground is `width` x `height` px, projected by `squash`. */
export function waterLook(width: number, height: number, layer: WetLayer, state: GroundWaterState, cap?: (i: number) => number, squash = 1): WaterLook {
  const { cols, frame, size, seed, blend } = layer;
  const field = blendField(blend, cap ? Float32Array.from(state.wetness, (w, i) => Math.min(w, cap(i))) : state.wetness);
  const { river } = state;
  const [W, H] = [width, Math.ceil(height * squash)];
  if (!river) return { field, lines: [], river: riverMask([], W, H, squash) };
  const isRiver = (i: number) => river.bed[i] >= riverBedAt(state.ground[i]) && state.wetness[i] < WETNESS.flooded;
  const centre = (i: number) => frameCentre(i % cols, Math.floor(i / cols), size, frame);
  const lines = riverLines(riverPaths(river.down, river.bed, isRiver), { centre, size, seed, bed: river.bed, flow: river.flow, ground: state.ground });
  return { field, lines, river: riverMask(lines, W, H, squash) };
}

/**
 * `base` graded by the water's `look` and with its rivers, as a new raster
 * squashed vertically by `squash` (the projected map, drawn as it is).
 * `water(x, y)` is the water's own colour at a pixel of `base`.
 */
export function paintWaterLook(base: Raster, layer: WetLayer, look: WaterLook, water: (x: number, y: number) => RGB, squash = 1): Raster {
  const { blend, keep, size, seed } = layer;
  const ground = createRaster(base.width, Math.ceil(base.height * squash));
  gradeGround(base, ground, blend, look.field, keep, layer.detail, water, squash);
  const unsquash = (py: number) => Math.min(base.height - 1, Math.floor((py + 0.5) / squash));
  paintRiverLines(ground, look.lines, {
    keep: (x, py) => keep[unsquash(py) * base.width + x] === 1 || sampleField(blend, look.field, x + 0.5, unsquash(py) + 0.5) >= UNDER_WATER,
    water: (x, py) => water(x, unsquash(py)),
    squash,
    seed,
    size,
  });
  return ground;
}

/** `base` graded and with its rivers (see paintWaterLook), and which pixels the rivers cover. */
export function paintGroundWater(base: Raster, layer: WetLayer, state: GroundWaterState, opts: GroundWaterOptions, squash = 1): { ground: Raster; river: RiverMask } {
  const look = waterLook(base.width, base.height, layer, state, opts.cap, squash);
  return { ground: paintWaterLook(base, layer, look, opts.water, squash), river: look.river };
}
