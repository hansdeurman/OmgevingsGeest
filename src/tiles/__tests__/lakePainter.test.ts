import { describe, expect, it } from 'vitest';
import { paintLake, type LakeArt, type LakeImage, type LakeState } from '../lakePainter';
import { lakeShapes, type LakeShape } from '../shores';
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
const art: LakeArt = {
  wall: strip([200, 0, 0]),
  spillWall: strip([0, 200, 0]),
  outfall: strip([255, 255, 255], 20),
  rim: solid([128, 128, 128]),
  water: { ice: solid([220, 240, 250]), cold: solid([0, 0, 200]), mild: solid([0, 0, 160]), warm: solid([0, 120, 60]) },
};
const full: LakeState = { rim: 16, water: 16, spill: 0, temperature: 0.4, wind: { strength: 0, direction: 0 } };

const shapeOf = (water: (x: number, y: number) => boolean): LakeShape =>
  lakeShapes(Float32Array.from({ length: W * W }, (_, i) => (water(i % W, Math.floor(i / W)) ? 6 : NaN)), W, W)[0];
const disc = shapeOf((x, y) => Math.hypot(x + 0.5 - 30, y + 0.5 - 30) <= 12);

/** The painted pixel where frame point (x, y), raised by h, lands. */
const at = (img: LakeImage, x: number, y: number, h: number) => getPixel(img.raster, x - img.x, Math.round(y * SQUASH - h) - img.y);
const isWater = ([r, , b, a]: number[]) => a === 255 && b > r + 50;
const isWall = ([r, g, b, a]: number[]) => a === 255 && r > 150 && g < 60 && b < 60;
/** The lowest frame row of column x that the lake's near wall hangs from. */
const nearFoot = (img: LakeImage, x: number) => {
  for (let y = W - 1; y >= 0; y--) if (isWall(at(img, x, y, 0))) return y;
  return -1;
};

describe('paintLake', () => {
  const img = paintLake(disc, full, art, SQUASH, SIZE);

  it('lifts the water to its level', () => {
    expect(isWater(at(img, 30, 30, 16))).toBe(true);
  });

  it('hangs a wall from the rim down to the floor along the near shore, capstone on top', () => {
    const foot = nearFoot(img, 30);
    expect(foot).toBeGreaterThan(42);
    for (let h = 1; h < 15; h++) expect(isWall(at(img, 30, foot, h))).toBe(true);
    const capRow = Math.round(foot * SQUASH - 16) - img.y - 1;
    expect(getPixel(img.raster, 30 - img.x, capRow).slice(0, 2)).toEqual([250, 220]);
  });

  it('casts a soft shadow on the floor in front of the wall', () => {
    const foot = nearFoot(img, 30);
    const [, , , a] = at(img, 30, foot + 3, 0);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(255);
  });

  it('rings the far shore with a rim at the height of the land', () => {
    const [r, g, b] = at(img, 30, 16, 16);
    expect(r).toBe(b);
    expect(g).toBe(b);
    expect(r).toBeGreaterThanOrEqual(128); // the rim's top catches the light
  });

  it('shows the basin\'s far wall above the water when the lake is low, wet just above the water line', () => {
    const big = shapeOf((x, y) => Math.hypot(x + 0.5 - 30, y + 0.5 - 30) <= 20);
    const top = 10; // first water row of the centre column
    expect(isWater(at(paintLake(big, full, art, SQUASH, SIZE), 30, top, 12))).toBe(true);
    const low = paintLake(big, { ...full, water: 8 }, art, SQUASH, SIZE);
    const [r, , b, a] = at(low, 30, top, 12);
    expect(a).toBe(255);
    expect(r).toBeGreaterThan(b + 80);
    expect(r).toBeLessThan(200); // in the basin's shade
    expect(at(low, 30, top, 9)[0]).toBeLessThan(r); // wet band
    expect(isWater(at(low, 30, 20, 8))).toBe(true);
  });

  it('turns the near wall into a spilling wall when the lake overflows', () => {
    const spill = paintLake(disc, { ...full, spill: 0.5 }, art, SQUASH, SIZE);
    const [r, g] = at(spill, 30, nearFoot(img, 30), 6);
    expect(g).toBeGreaterThan(150);
    expect(r).toBeLessThan(60);
  });

  it('pours a waterfall down the near wall at the outlet, only while full and only when the outlet faces the viewer', () => {
    const white = (l: LakeImage) => at(l, 30, nearFoot(img, 30), 8).slice(0, 3).every((c) => c > 200);
    expect(white(paintLake(disc, { ...full, outlet: { x: 30, y: 46 } }, art, SQUASH, SIZE))).toBe(true);
    expect(white(paintLake(disc, { ...full, water: 12, outlet: { x: 30, y: 46 } }, art, SQUASH, SIZE))).toBe(false);
    expect(white(paintLake(disc, { ...full, outlet: { x: 30, y: 14 } }, art, SQUASH, SIZE))).toBe(false);
  });

  it('hangs the waterfall from a straight stretch of wall, never smeared along a bend', () => {
    const side = paintLake(disc, { ...full, outlet: { x: 44, y: 32 } }, art, SQUASH, SIZE).raster;
    const white: number[][] = [];
    for (let y = 0; y < side.height; y++)
      for (let x = 0; x < side.width; x++) if (getPixel(side, x, y).every((c) => c > 220)) white.push([x, y]);
    expect(white.length).toBeGreaterThan(0);
    const rows = white.map(([, y]) => y);
    expect(Math.max(...rows) - Math.min(...rows)).toBeLessThanOrEqual(16 + 3 + 3); // one wall's height (rim + capstone), give or take a row
  });

  it('shows ice when frozen and warm water when warm', () => {
    const [ir, ig, ib] = at(paintLake(disc, { ...full, temperature: 0 }, art, SQUASH, SIZE), 30, 30, 16);
    expect(Math.min(ir, ig, ib)).toBeGreaterThan(150);
    expect(ib).toBeGreaterThan(ir);
    const [r, g, b] = at(paintLake(disc, { ...full, temperature: 1 }, art, SQUASH, SIZE), 30, 30, 16);
    expect(g).toBeGreaterThan(Math.max(r, b));
  });

  it('draws a nearer arm of the lake over the wall of a farther one', () => {
    const bar = shapeOf((x, y) => Math.hypot(x + 0.5 - 30, y + 0.5 - 30) <= 16 && !(x < 34 && y >= 27 && y <= 33));
    const armed = paintLake(bar, full, art, SQUASH, SIZE);
    expect(isWater(at(armed, 25, 36, 16))).toBe(true);
  });
});
