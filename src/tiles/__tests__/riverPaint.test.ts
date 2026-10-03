import { describe, expect, it } from 'vitest';
import { paintRivers, riverCurve, riverLines, riverPaths, type RiverPaint } from '../riverPaint';
import { createRaster, getPixel, setPixel } from '../raster';
import type { Pixel } from '../../math/hex';
import type { RGB } from '../../rendering/palette';

// A little river system on hexes 0–7: 1 → 2 → 3 → 4 (the sea), 5 → 6 → 2 a tributary, 0 a dry hex feeding 1, 7 off on its own.
const down = Int32Array.of(1, 2, 3, 4, -1, 6, 2, -1);
const bed = Float32Array.of(0.01, 0.06, 0.2, 0.25, 0, 0.05, 0.08, 0);
const isRiver = (i: number) => bed[i] >= 0.04 && i !== 4;

describe('riverPaths', () => {
  const paths = riverPaths(down, bed, isRiver);

  it('runs each river from its source down to where it ends: the sea, a lake, or the river it joins', () => {
    const main = paths.find((p) => p.includes(1))!;
    expect(main).toEqual([0, 1, 2, 3, 4]);
    expect(paths.find((p) => p.includes(5))).toEqual([5, 6, 2]);
  });

  it('draws each stretch of river once', () => {
    const stretches = paths.flatMap((p) => p.slice(1).map((b, k) => `${p[k]}-${b}`));
    expect(new Set(stretches).size).toBe(stretches.length);
    expect(paths).toHaveLength(2);
  });

  it('starts a river from the hex that feeds it, so it springs from somewhere', () => {
    expect(paths.find((p) => p.includes(1))![0]).toBe(0);
  });
});

describe('riverCurve', () => {
  const SIZE = 20;
  const centre = (i: number): Pixel => ({ x: 30 + i * SIZE * 1.7, y: 40 });
  const cells = [0, 1, 2, 3, 4];
  const curve = riverCurve(cells, centre, SIZE, 1);

  it('winds: it does not run straight from hex to hex', () => {
    const off = Math.max(...curve.points.map((p) => Math.abs(p.y - 40)));
    expect(off).toBeGreaterThan(0.1 * SIZE);
  });

  it('stays close to the hexes it runs through, so rivers that meet join up', () => {
    for (const p of curve.points) expect(Math.abs(p.y - 40)).toBeLessThan(0.6 * SIZE);
    const [first, last] = [curve.points[0], curve.points.at(-1)!];
    expect(Math.hypot(first.x - centre(0).x, first.y - 40)).toBeLessThan(0.3 * SIZE);
    expect(Math.hypot(last.x - centre(4).x, last.y - 40)).toBeLessThan(0.3 * SIZE);
  });

  it('winds the same way every time, and the same through a hex whichever river runs there', () => {
    expect(riverCurve(cells, centre, SIZE, 1)).toEqual(curve);
    const branch = riverCurve([2, 3], centre, SIZE, 1);
    expect(branch.points[0]).toEqual(riverCurve([0, 1, 2], centre, SIZE, 1).points.at(-1));
  });

  it('tells how far along it each hex lies', () => {
    expect(curve.along[0]).toBe(0);
    expect(curve.along.at(-1)).toBe(1);
    for (let k = 1; k < curve.along.length; k++) expect(curve.along[k]).toBeGreaterThan(curve.along[k - 1]);
  });
});

describe('paintRivers', () => {
  const SIZE = 20;
  const [W, H] = [200, 80];
  const GROUND: RGB = [100, 160, 70];
  const WATER: RGB = [30, 100, 170];
  const centre = (i: number): Pixel => ({ x: 20 + i * 34, y: 40 });
  const paint = (flow: number[]) => {
    const target = createRaster(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) setPixel(target, x, y, GROUND);
    const ctx: RiverPaint = { centre, size: SIZE, seed: 1, bed, flow: Float32Array.from(flow), ground: new Float32Array(8), keep: () => false, water: () => WATER };
    const mask = paintRivers(target, [[0, 1, 2, 3, 4]], ctx);
    return { target, mask };
  };
  const along = (r: ReturnType<typeof paint>, i: number) => {
    // The river's pixels across hex i's middle column.
    const x = Math.round(centre(i).x);
    return Array.from({ length: H }, (_, y) => y).filter((y) => r.mask[y * W + x]).map((y) => getPixel(r.target, x, y));
  };
  const isWater = ([r, , b]: number[]) => b > r + 60;
  const isGround = ([r, g, b]: number[]) => g > r && g > b;

  it('shows a dry bed where no water runs: stones, not water', () => {
    const dry = along(paint([0, 0, 0, 0, 0, 0, 0, 0]), 2);
    expect(dry.length).toBeGreaterThan(3);
    expect(dry.some(isWater)).toBe(false);
    expect(dry.every(isGround)).toBe(false);
  });

  it('fills the bed with water as the river runs, wider the more it carries', () => {
    const wet = (flow: number) => along(paint([0, flow, flow, flow, 0, 0, 0, 0]), 2).filter(isWater).length;
    expect(wet(0.01)).toBeGreaterThan(0);
    expect(wet(0.2)).toBeGreaterThan(wet(0.01));
  });

  it('widens its bed downstream, as the river grows', () => {
    const r = paint([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(along(r, 3).length).toBeGreaterThan(along(r, 1).length);
  });

  it('marks the pixels it painted, so nothing stands in the river', () => {
    const { mask } = paint([0, 0.1, 0.1, 0.1, 0, 0, 0, 0]);
    expect(mask.some((v) => v)).toBe(true);
    expect(mask[5 * W + 5]).toBe(0);
  });
});

describe('riverLines', () => {
  const SIZE = 20;
  const centre = (i: number): Pixel => ({ x: 20 + i * 34, y: 40 });
  const shape = (flow: number[]) => ({ centre, size: SIZE, seed: 1, bed, flow: Float32Array.from(flow), ground: new Float32Array(8) });
  const [line] = riverLines([[0, 1, 2, 3, 4]], shape([0, 0.01, 0.01, 0.1, 0]));

  it('follows the river\'s winding line', () => {
    expect(line.points).toEqual(riverCurve([0, 1, 2, 3, 4], centre, SIZE, 1).points);
    expect(line.bed).toHaveLength(line.points.length);
    expect(line.water).toHaveLength(line.points.length);
  });

  it('widens the bed downstream, and the water with the flow, none where too little runs', () => {
    expect(line.bed.at(-2)!).toBeGreaterThan(line.bed[1]);
    expect(line.water[0]).toBe(0); // its spring carries nothing yet
    expect(Math.max(...line.water)).toBeGreaterThan(0);
  });

  it('marks white water only where a running river drops steeply', () => {
    expect(Math.max(...line.foam)).toBe(0);
    const steep = riverLines([[0, 1, 2, 3, 4]], { ...shape([0, 0.1, 0.1, 0.1, 0]), ground: Float32Array.of(8, 8, 6, 4, 4, 0, 0, 0) })[0];
    expect(Math.max(...steep.foam)).toBeGreaterThan(0.5);
  });
});
