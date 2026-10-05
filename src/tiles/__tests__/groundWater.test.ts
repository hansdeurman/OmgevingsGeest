import { describe, expect, it } from 'vitest';
import { WETNESS } from '../../water/wetness';
import { gridFrame, frameCentre } from '../geometry';
import { paintGroundWater, riverBedAt, wetLayer, RIVER_BED } from '../groundWater';
import { createRaster, getPixel, setPixel } from '../raster';
import type { RGB } from '../../rendering/palette';

const SIZE = 20;
const [cols, rows] = [6, 3];
const frame = gridFrame(cols, rows, SIZE);
const GRASS: RGB = [92, 150, 62];
const WATER: RGB = [40, 110, 160];
const base = createRaster(frame.width, frame.height);
for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) setPixel(base, x, y, GRASS);
const layer = wetLayer(cols, rows, frame, SIZE, new Uint8Array(frame.width * frame.height), 1);
const n = cols * rows;
const even = (stage: number) => new Float32Array(n).fill(stage);
/** A river along the middle row, from west to east and off the map. */
const river = (flow: number) => ({
  flow: new Float32Array(n).fill(flow),
  bed: Float32Array.from({ length: n }, (_, i) => (Math.floor(i / cols) === 1 ? 0.2 : 0)),
  down: Int32Array.from({ length: n }, (_, i) => (Math.floor(i / cols) === 1 && i % cols < cols - 1 ? i + 1 : -1)),
});
const paint = (wetness: Float32Array, opts: { flow?: number; cap?: (i: number) => number } = {}) =>
  paintGroundWater(base, layer, { wetness, river: river(opts.flow ?? 0), ground: new Float32Array(n) }, { cap: opts.cap, water: () => WATER });
const middle = (c: number, r: number) => {
  const p = frameCentre(c, r, SIZE, frame);
  return [Math.round(p.x), Math.round(p.y)] as const;
};
const isWater = ([r, , b]: number[]) => b > r + 50;

describe('paintGroundWater', () => {
  it('leaves ground of normal wetness as painted, away from rivers', () => {
    const { ground } = paint(even(WETNESS.normal));
    expect(getPixel(ground, ...middle(2, 0))).toEqual(getPixel(base, ...middle(2, 0)));
  });

  it('grades the ground by how wet its hexes are', () => {
    const { ground } = paint(even(WETNESS.flooded));
    expect(isWater(getPixel(ground, ...middle(2, 0)))).toBe(true);
  });

  it('keeps water off hexes whose water is drawn apart (a high lake): their ground at most turns moist', () => {
    const { ground } = paint(even(WETNESS.flooded), { cap: () => WETNESS.moist });
    expect(isWater(getPixel(ground, ...middle(2, 0)))).toBe(false);
  });

  it('paints the rivers, full or dry, and tells where they run', () => {
    const dry = paint(even(WETNESS.normal));
    const [x, y] = middle(2, 1);
    expect(dry.river.data.some((v) => v)).toBe(true);
    expect(isWater(getPixel(dry.ground, x, y))).toBe(false);
    const running = paint(even(WETNESS.normal), { flow: 0.1 });
    const column = Array.from({ length: 2 * SIZE }, (_, k) => getPixel(running.ground, x, y - SIZE + k));
    expect(column.some(isWater)).toBe(true);
  });

  it('draws no river through water standing over it', () => {
    const { river } = paint(even(WETNESS.flooded), { flow: 0.1 });
    expect(river.data.some((v) => v)).toBe(false);
  });

  it('paints the map projected, squashed as the view squashes it, rivers and all', () => {
    const flat = paintGroundWater(base, layer, { wetness: even(WETNESS.normal), river: river(0.1), ground: new Float32Array(n) }, { water: () => WATER }, 0.5);
    expect(flat.ground.height).toBe(Math.ceil(frame.height / 2));
    const [x, y] = middle(2, 1);
    const column = Array.from({ length: SIZE }, (_, k) => getPixel(flat.ground, x, Math.round(y / 2) - SIZE / 2 + k));
    expect(column.some(isWater)).toBe(true);
    expect(flat.river.data.length).toBe(Math.ceil(flat.ground.width / flat.river.cell) * Math.ceil(flat.ground.height / flat.river.cell));
  });

  it('shows a stream in the mountains from a thinner bed than a river needs below', () => {
    const thin = { ...river(0.1), bed: new Float32Array(n).fill(RIVER_BED * 0.5) };
    const at = (height: number) => paintGroundWater(base, layer, { wetness: even(WETNESS.normal), river: thin, ground: new Float32Array(n).fill(height) }, { water: () => WATER }).river;
    expect(at(0).data.some((v) => v)).toBe(false);
    expect(at(7).data.some((v) => v)).toBe(true);
    expect(riverBedAt(7)).toBeLessThan(riverBedAt(1));
  });

  it('draws no river where the bed is worn too little', () => {
    const shallow = { ...river(0.1), bed: new Float32Array(n).fill(RIVER_BED * 0.9) };
    const { river: mask } = paintGroundWater(base, layer, { wetness: even(WETNESS.normal), river: shallow, ground: new Float32Array(n) }, { water: () => WATER });
    expect(mask.data.some((v) => v)).toBe(false);
  });
});
