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
/** A wall whose capstone is yellow and whose face is `face`. */
const strip = (face: RGB, width = 10): WallStrip => ({
  image: paintRaster(width, 40, (_, y) => (y < 3 ? [250, 220, 0] : face)),
  lip: 3,
  from: 15,
  to: 25,
});
const FLOOR: RGB = [10, 200, 10];
const art: LakeArt = {
  wall: strip([200, 0, 0]),
  spillWall: strip([0, 200, 0]),
  outfall: strip([255, 255, 255], 20),
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
const isWall = ([r, g, b, a]: number[]) => a === 255 && r > 150 && g < 60 && b < 60;
/** The lowest frame row of column x that the lake's near wall hangs from. */
const nearFoot = (img: LakeImage, x: number) => {
  for (let y = W - 1; y >= 0; y--) if (isWall(at(img, x, y, 0))) return y;
  return -1;
};
const wallRows = (img: LakeImage, x: number) => {
  let n = 0;
  for (let y = 0; y < img.raster.height; y++) if (isWall(getPixel(img.raster, x - img.x, y))) n++;
  return n;
};

describe('paintLake', () => {
  const img = paint(disc);

  it('lifts the water to its level', () => {
    expect(isWater(at(img, 30, 30, LIFT))).toBe(true);
  });

  it('hangs a wall from the water\'s rim down to the floor along the near shore, capstone on top', () => {
    const foot = nearFoot(img, 30);
    expect(foot).toBeGreaterThan(42);
    for (let h = 1; h < LIFT - 1; h++) expect(isWall(at(img, 30, foot, h))).toBe(true);
    const capRow = Math.round(foot * SQUASH - LIFT) - img.y - 1;
    expect(getPixel(img.raster, 30 - img.x, capRow).slice(0, 2)).toEqual([250, 220]);
  });

  it('casts a soft shadow on the floor in front of the wall', () => {
    const [, , , a] = at(img, 30, nearFoot(img, 30) + 3, 0);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(255);
  });

  it('rings the far shore with a rim at the water\'s height', () => {
    const [r, g, b] = at(img, 30, 16, LIFT);
    expect(r).toBe(b);
    expect(g).toBe(b);
    expect(r).toBeGreaterThanOrEqual(128); // the rim's top catches the light
  });

  it('stands an uneven lake higher where its water is higher, with a taller wall there', () => {
    const tilted = paint(shapeOf(inDisc(14), (x) => 4 + (x / W) * 3));
    expect(wallRows(tilted, 40)).toBeGreaterThan(wallRows(tilted, 20) + 2);
  });

  it('shows foam where an uneven lake still runs downhill, none on a level one', () => {
    const tilted = paint(shapeOf(inDisc(14), (x) => 4 + (x / W) * 6));
    const level = paint(shapeOf(inDisc(14), () => 7));
    const brightness = (l: LakeImage, h: number) => at(l, 30, 30, h).slice(0, 3).reduce((a, b) => a + b);
    expect(brightness(tilted, lakeLift(4 + 0.5 * 6) * SIZE)).toBeGreaterThan(brightness(level, lakeLift(7) * SIZE) + 30);
  });

  it('shows the land of an island at the water\'s height', () => {
    const island = paint(shapeOf((x, y) => inDisc(14)(x, y) && !inDisc(3)(x, y)));
    expect(at(island, 30, 30, LIFT).slice(0, 3)).toEqual(FLOOR);
  });

  it('lets the floor show through shallow water, not through deep water', () => {
    const toFloor = (l: LakeImage, h: number) => at(l, 30, 30, h)[1]; // the floor is green, the water blue
    const shallow = paint(shapeOf(inDisc(12), () => 6, 5.9));
    const deep = paint(shapeOf(inDisc(12), () => 6, 3));
    expect(toFloor(shallow, LIFT)).toBeGreaterThan(toFloor(deep, LIFT) + 40);
  });

  it('turns the near wall into a spilling wall when the lake overflows', () => {
    const [r, g] = at(paint(disc, { spill: 0.5 }), 30, nearFoot(img, 30), 6);
    expect(g).toBeGreaterThan(150);
    expect(r).toBeLessThan(60);
  });

  it('pours a waterfall down the near wall at its outlet, only when the outlet faces the viewer', () => {
    const white = (l: LakeImage) => at(l, 30, nearFoot(img, 30), 8).slice(0, 3).every((c) => c > 200);
    expect(white(paint(disc, { outlet: { x: 30, y: 46 } }))).toBe(true);
    expect(white(paint(disc))).toBe(false);
    expect(white(paint(disc, { outlet: { x: 30, y: 14 } }))).toBe(false);
  });

  it('hangs the waterfall from a straight stretch of wall, never smeared along a bend', () => {
    const side = paint(disc, { outlet: { x: 44, y: 32 } }).raster;
    const rows: number[] = [];
    for (let y = 0; y < side.height; y++) for (let x = 0; x < side.width; x++) if (getPixel(side, x, y).every((c) => c > 220)) rows.push(y);
    expect(rows.length).toBeGreaterThan(0);
    expect(Math.max(...rows) - Math.min(...rows)).toBeLessThanOrEqual(LIFT + 3 + 3); // one wall's height (rim + capstone), give or take a row
  });

  it('shows ice when frozen and warm water when warm', () => {
    const [ir, ig, ib] = at(paint(disc, { temperature: 0 }), 30, 30, LIFT);
    expect(Math.min(ir, ig, ib)).toBeGreaterThan(150);
    expect(ib).toBeGreaterThan(ir);
    const [r, g, b] = at(paint(disc, { temperature: 1 }), 30, 30, LIFT);
    expect(g).toBeGreaterThan(Math.max(r, b));
  });

  it('draws a nearer arm of the lake over the wall of a farther one', () => {
    const armed = paint(shapeOf((x, y) => inDisc(16)(x, y) && !(x < 34 && y >= 27 && y <= 33)));
    expect(isWater(at(armed, 25, 36, LIFT))).toBe(true);
  });
});
