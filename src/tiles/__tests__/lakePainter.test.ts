import { describe, expect, it } from 'vitest';
import { paintLake, type LakeArt, type LakeImage, type LakeState } from '../lakePainter';
import { lakeLift, lakeShapes, type LakeShape } from '../shores';
import { getPixel, paintRaster } from '../raster';
import type { WallStrip } from '../wallStrip';
import type { RGB } from '../../rendering/palette';

const SIZE = 20;
const SQUASH = 0.5;
const W = 60;
const solid = (c: RGB) => paintRaster(4, 4, () => c);
const ROCK: RGB = [200, 0, 0];
const FLOOR: RGB = [10, 200, 10];
const rock: WallStrip = { image: paintRaster(10, 40, () => ROCK), lip: 3, from: 15, to: 25 };
const art: LakeArt = {
  wall: rock,
  rim: solid([128, 128, 128]),
  floor: solid(FLOOR),
  water: { ice: solid([220, 240, 250]), cold: solid([0, 0, 200]), mild: solid([0, 0, 160]), warm: solid([0, 120, 60]) },
};
const calm: LakeState = { spill: 0, temperature: 0.4, wind: { strength: 0, direction: 0 } };
const LIFT = lakeLift(6) * SIZE;

/** A lake where `water` holds, its level per pixel from `level`, over ground `floor` (steps). */
const shapeOf = (water: (x: number, y: number) => boolean, level: (x: number) => number = () => 6, floor = 4): LakeShape =>
  lakeShapes(
    Float32Array.from({ length: W * W }, (_, i) => (water(i % W, Math.floor(i / W)) ? level(i % W) : NaN)),
    W,
    W,
    0,
    new Float32Array(W * W).fill(floor),
  )[0];
const inDisc = (r: number, cx = 30, cy = 30) => (x: number, y: number) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r;
const disc = shapeOf(inDisc(12));
const paint = (shape: LakeShape, state: Partial<LakeState> = {}) => paintLake(shape, { ...calm, ...state }, art, SQUASH, SIZE);

/** The painted pixel where frame point (x, y), raised by h, lands. */
const at = (img: LakeImage, x: number, y: number, h: number) => getPixel(img.raster, x - img.x, Math.round(y * SQUASH - h) - img.y);
const isWater = ([r, , b, a]: number[]) => a === 255 && b > r + 50;
/** How high the painted object stands at frame point (x, y), and what is there. */
const surfaceAt = (img: LakeImage, x: number, y: number) => {
  const s = img.surface;
  const i = (y - s.y0) * s.width + (x - s.x0);
  return { lift: s.lift[i], kind: s.kind[i] };
};

describe('paintLake', () => {
  const img = paint(disc);

  it('lifts the water to its level', () => {
    expect(isWater(at(img, 30, 30, LIFT))).toBe(true);
    expect(surfaceAt(img, 30, 30)).toEqual({ lift: expect.closeTo(LIFT, 3), kind: 1 });
  });

  it('runs the land down from the rim to the floor gradually, as a mountain flank, not a wall', () => {
    const below = Array.from({ length: 22 }, (_, k) => surfaceAt(img, 30, 43 + k)).filter((s) => s.kind === 3);
    expect(below.length).toBeGreaterThan(8); // the flank reaches out well in front of the lake
    for (let k = 1; k < below.length; k++) {
      expect(below[k].lift).toBeLessThanOrEqual(below[k - 1].lift + 1e-6);
      expect(below[k - 1].lift - below[k].lift).toBeLessThan(LIFT / 3); // no sudden drop
    }
    expect(below[below.length - 1].lift).toBeLessThan(LIFT * 0.2);
  });

  it('paints the flank with the land under it, a band of rock just under the rim', () => {
    const [r, g] = at(img, 30, 52, surfaceAt(img, 30, 52).lift);
    expect(g).toBeGreaterThan(r); // the green floor
    const rim = surfaceAt(img, 30, 45);
    const [rr, rg] = at(img, 30, 45, rim.lift);
    expect(rr).toBeGreaterThan(rg); // the rock
  });

  it('fills the slope down to the floor without gaps', () => {
    const column = Array.from({ length: img.raster.height }, (_, y) => getPixel(img.raster, 30 - img.x, y)[3]);
    const first = column.findIndex((a) => a === 255);
    const last = column.length - 1 - [...column].reverse().findIndex((a) => a === 255);
    expect(column.slice(first, last + 1).every((a) => a === 255)).toBe(true);
  });

  it('rings the shore with a rim at the water\'s height', () => {
    const [r, g, b] = at(img, 30, 16, LIFT);
    expect(r).toBe(b);
    expect(g).toBe(b);
  });

  it('stands an uneven lake higher where its water is higher', () => {
    const tilted = paint(shapeOf(inDisc(14), (x) => 4 + (x / W) * 3));
    expect(surfaceAt(tilted, 40, 30).lift).toBeGreaterThan(surfaceAt(tilted, 20, 30).lift + 2);
  });

  it('shows foam where an uneven lake still runs downhill, none on a level one', () => {
    const tilted = paint(shapeOf(inDisc(14), (x) => 4 + (x / W) * 6));
    const level = paint(shapeOf(inDisc(14), () => 7));
    const brightness = (l: LakeImage, h: number) => at(l, 30, 30, h).slice(0, 3).reduce((a, b) => a + b);
    expect(brightness(tilted, surfaceAt(tilted, 30, 30).lift)).toBeGreaterThan(brightness(level, lakeLift(7) * SIZE) + 30);
  });

  it('shows the land of an island at the water\'s height', () => {
    const island = paint(shapeOf((x, y) => inDisc(14)(x, y) && !inDisc(3)(x, y)));
    expect(at(island, 30, 30, LIFT).slice(0, 3)).toEqual(FLOOR);
    expect(surfaceAt(island, 30, 30).kind).toBe(2);
  });

  it('lets the floor show through shallow water, not through deep water', () => {
    const toFloor = (l: LakeImage, h: number) => at(l, 30, 30, h)[1];
    expect(toFloor(paint(shapeOf(inDisc(12), () => 6, 5.9)), LIFT)).toBeGreaterThan(toFloor(paint(shapeOf(inDisc(12), () => 6, 3)), LIFT) + 40);
  });

  it('runs a stream down the flank where the lake pours out, and only there', () => {
    const pouring = paint(disc, { outlet: { x: 30, y: 43 }, outflow: 0.1 });
    const y = 50;
    expect(isWater(at(pouring, 30, y, surfaceAt(pouring, 30, y).lift))).toBe(true);
    expect(isWater(at(img, 30, y, surfaceAt(img, 30, y).lift))).toBe(false);
    expect(isWater(at(pouring, 20, y, surfaceAt(pouring, 20, y).lift))).toBe(false);
  });

  it('wets the rim all round when the lake spills over it', () => {
    const spill = paint(disc, { spill: 1 });
    const [r, , b] = at(spill, 30, 44, surfaceAt(spill, 30, 44).lift);
    expect(b).toBeGreaterThan(r);
  });

  it('shows ice when frozen and warm water when warm', () => {
    const [ir, ig, ib] = at(paint(disc, { temperature: 0 }), 30, 30, LIFT);
    expect(Math.min(ir, ig, ib)).toBeGreaterThan(150);
    expect(ib).toBeGreaterThan(ir);
    const [r, g, b] = at(paint(disc, { temperature: 1 }), 30, 30, LIFT);
    expect(g).toBeGreaterThan(Math.max(r, b));
  });

  it('draws a nearer arm of the lake over the land of a farther one', () => {
    const armed = paint(shapeOf((x, y) => inDisc(16)(x, y) && !(x < 34 && y >= 27 && y <= 33)));
    expect(isWater(at(armed, 25, 36, LIFT))).toBe(true);
  });
});
