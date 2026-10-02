import { describe, expect, it } from 'vitest';
import { HIGH_LAKE_FROM, lakeLift, lakeShapes } from '../shores';
import { MAX_ELEVATION } from '../levels';

const W = 60;
/** Level per pixel: NaN everywhere except discs of the given level. */
const levels = (...discs: { x: number; y: number; r: number; level: number }[]) =>
  Float32Array.from({ length: W * W }, (_, i) => {
    const [x, y] = [i % W, Math.floor(i / W)];
    const d = discs.find((c) => Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) <= c.r);
    return d ? d.level : NaN;
  });
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

  it('marks dry land the water surrounds as island, not as a hole', () => {
    const lv = levels({ x: 30, y: 30, r: 15, level: 6 });
    lv[30 * W + 30] = NaN;
    const [shape] = lakeShapes(lv, W, W);
    const at = (x: number, y: number) => (y - shape.y0) * shape.width + (x - shape.x0);
    expect(shape.mask[at(30, 30)]).toBe(2);
    expect(shape.mask[at(30, 20)]).toBe(1);
    expect(shape.levels[at(30, 30)]).toBe(6); // an island stands in the water's level
  });

  it('keeps each pixel\'s own level, so an uneven lake shows its slope', () => {
    const lv = levels({ x: 30, y: 30, r: 15, level: 0 }).map((l, i) => (Number.isNaN(l) ? l : 4 + (i % W) / W));
    const [shape] = lakeShapes(lv, W, W);
    const at = (x: number) => (30 - shape.y0) * shape.width + (x - shape.x0);
    expect(shape.levels[at(40)]).toBeGreaterThan(shape.levels[at(20)]);
    expect(shape.top).toBeGreaterThan(shape.level);
    expect(shape.level).toBeCloseTo(4.5, 1);
  });

  it('measures the water\'s depth over the ground under it', () => {
    const ground = Float32Array.from({ length: W * W }, (_, i) => 3 + (i % W) / W);
    const [shape] = lakeShapes(levels({ x: 30, y: 30, r: 15, level: 5 }), W, W, 0, ground);
    const at = (x: number) => (30 - shape.y0) * shape.width + (x - shape.x0);
    expect(shape.depth[at(20)]).toBeCloseTo(5 - (3 + 20 / W), 5);
    expect(shape.depth[at(20)]).toBeGreaterThan(shape.depth[at(40)]);
  });
});

describe('lakeLift', () => {
  it('lifts higher lakes further, up to about a hex', () => {
    expect(lakeLift(MAX_ELEVATION - 1)).toBeGreaterThan(lakeLift(HIGH_LAKE_FROM + 0.5));
    expect(lakeLift(HIGH_LAKE_FROM)).toBeGreaterThan(0);
    expect(lakeLift(MAX_ELEVATION)).toBeLessThanOrEqual(1);
  });
});
