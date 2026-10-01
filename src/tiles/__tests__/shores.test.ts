import { describe, expect, it } from 'vitest';
import { HIGH_LAKE_FROM, LIP, lakeLift, lakeShapes, shoreClass, shoreProps, shoreSamples, type LakeShape } from '../shores';
import { MAX_ELEVATION } from '../levels';

const W = 60;
/** Level per pixel: NaN everywhere except discs of the given level. */
const levels = (...discs: { x: number; y: number; r: number; level: number }[]) =>
  Float32Array.from({ length: W * W }, (_, i) => {
    const [x, y] = [i % W, Math.floor(i / W)];
    const d = discs.find((c) => Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) <= c.r);
    return d ? d.level : NaN;
  });
const disc = (r = 15, level = 6) => lakeShapes(levels({ x: 30, y: 30, r, level }), W, W)[0];

describe('lakeShapes', () => {
  it('finds each high lake as its own shape, with its level', () => {
    const shapes = lakeShapes(levels({ x: 12, y: 12, r: 6, level: 3 }, { x: 45, y: 45, r: 8, level: 7 }), W, W);
    expect(shapes.map((s) => s.level).sort()).toEqual([3, 7]);
  });

  it('ignores specks of water too small to be a lake', () => {
    const lv = levels({ x: 30, y: 30, r: 15, level: 6 });
    lv[2 * W + 2] = 6;
    expect(lakeShapes(lv, W, W, 20)).toHaveLength(1);
  });

  it('fills islands and shallows inside a lake, so the water has no holes', () => {
    const lv = levels({ x: 30, y: 30, r: 15, level: 6 });
    lv[30 * W + 30] = NaN;
    const [shape] = lakeShapes(lv, W, W);
    expect(shape.mask[(30 - shape.y0) * shape.width + (30 - shape.x0)]).toBe(1);
  });
});

describe('shoreSamples', () => {
  const shape = disc();
  const samples = shoreSamples(shape, 6);

  it('walks around the shore at about the given spacing', () => {
    expect(samples.length).toBeGreaterThan(8);
    for (const s of samples) expect(Math.abs(Math.hypot(s.x - 30, s.y - 30) - 15)).toBeLessThan(2);
    for (const a of samples) for (const b of samples) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(6);
  });

  it('points each sample\'s normal away from the water', () => {
    for (const s of samples) expect(s.nx * (s.x - 30) + s.ny * (s.y - 30)).toBeGreaterThan(0);
  });
});

describe('lakeLift and shoreClass', () => {
  it('lifts higher lakes further and gives them taller banks', () => {
    expect(lakeLift(MAX_ELEVATION - 1)).toBeGreaterThan(lakeLift(HIGH_LAKE_FROM + 0.5));
    expect(shoreClass(lakeLift(HIGH_LAKE_FROM))).toBe('low');
    expect(shoreClass(lakeLift(MAX_ELEVATION))).toBe('high');
  });
});

describe('shoreProps', () => {
  const SIZE = 20;
  const shape: LakeShape = disc(15, 7);
  const { back, front, lift } = shoreProps(shape, SIZE, 1);

  it('lifts the far-shore rocks with the water, keeping them small: a rim, not a plateau', () => {
    expect(lift).toBeCloseTo(lakeLift(7) * SIZE, 6);
    for (const p of back) expect(p.height!).toBeLessThan(0.6 * SIZE);
  });

  it('keeps banks off the sides and far shore, where they would stand in the water', () => {
    const top = shape.y0 + shape.height / 2;
    expect(front.every((p) => p.y > top)).toBe(true);
  });

  it('puts no bank on land between two arms of the same lake: the water there is level on both sides', () => {
    const lv = levels({ x: 30, y: 30, r: 22, level: 7 });
    for (let y = 24; y < 29; y++) for (let x = 30; x < 55; x++) lv[y * W + x] = NaN; // a bar of land from the right, water above and below
    const [armed] = lakeShapes(lv, W, W);
    const banks = shoreProps(armed, SIZE, 1).front;
    expect(banks.some((p) => p.x > 32 && p.x < 50 && p.y < 32)).toBe(false);
  });

  it('puts banks along the near shore and rocks along the far shore', () => {
    expect(front.length).toBeGreaterThan(3);
    expect(back.length).toBeGreaterThan(2);
    expect(front.every((p) => p.kind.startsWith('bank'))).toBe(true);
    expect(back.every((p) => p.kind === 'backRock')).toBe(true);
    expect(Math.min(...front.map((p) => p.y))).toBeGreaterThan(Math.min(...back.map((p) => p.y)));
  });

  it('chooses the bank height by the lake\'s height, and sizes each bank so its lip meets the water', () => {
    expect(front.every((p) => p.kind === 'bankHigh')).toBe(true);
    for (const p of front) expect((1 - (LIP as Record<string, number>)[p.kind]) * p.height!).toBeCloseTo(lift, 3);
  });

  it('orders the pieces back to front', () => {
    for (const list of [back, front]) for (let k = 1; k < list.length; k++) expect(list[k].y).toBeGreaterThanOrEqual(list[k - 1].y);
  });

  it('turns the bank facing the outlet into a waterfall with spray at its foot, but only when it faces the viewer', () => {
    const spill = shoreProps(shape, SIZE, 1, { x: 30, y: 60 }).front;
    expect(spill.filter((p) => p.kind === 'fallHigh')).toHaveLength(1);
    expect(spill.filter((p) => p.kind === 'spray')).toHaveLength(1);
    const away = shoreProps(shape, SIZE, 1, { x: 30, y: 0 }).front;
    expect(away.some((p) => p.kind.startsWith('fall'))).toBe(false);
  });
});
