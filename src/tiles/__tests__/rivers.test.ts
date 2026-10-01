import { describe, expect, it } from 'vitest';
import { lakeRivers, riverStroke, smoothPath } from '../rivers';

/** Build a cols×rows elevation map from row strings of digits. */
const grid = (...rows: string[]) => ({
  cols: rows[0].length,
  rows: rows.length,
  elevation: rows.flatMap((r) => [...r].map(Number)),
});

describe('lakeRivers', () => {
  // A lake (5s) held by a rim of 7s with a notch of 4 below it; the slope then runs down to the sea row (0s).
  const g = grid('7777777', '7755777', '7774777', '7773777', '7772777', '0000000');
  const isLake = (i: number) => i === 9 || i === 10;
  const isSea = (i: number) => i >= 35;

  it('runs from the lake through its outlet down to the sea, always downhill', () => {
    const [river] = lakeRivers(g, isLake, isSea);
    expect(isLake(river.cells[0])).toBe(true);
    expect(river.cells).toContain(17); // the notch
    expect(isSea(river.cells[river.cells.length - 1])).toBe(true);
    for (let k = 2; k < river.cells.length; k++) {
      expect(g.elevation[river.cells[k]]).toBeLessThanOrEqual(g.elevation[river.cells[k - 1]]);
    }
  });

  it('marks a cascade where the lake pours out, and further down only where the river drops steeply', () => {
    const [river] = lakeRivers(g, isLake, isSea, 1.5);
    expect(river.cascades[0]).toEqual([river.cells[0], 17]); // over the notch
    const below = river.cascades.slice(1).map(([a, b]) => g.elevation[a] - g.elevation[b]);
    expect(below).toEqual([2]); // the gentle steps of 1 get none, the drop of 2 into the sea does
  });

  it('gives one river per lake', () => {
    const two = grid('7777777', '7577757', '7477747', '0000000');
    const rivers = lakeRivers(two, (i) => i === 8 || i === 12, (i) => i >= 21);
    expect(rivers).toHaveLength(2);
  });
});

describe('smoothPath', () => {
  it('keeps the ends and rounds the corners', () => {
    const out = smoothPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 2);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 10, y: 10 });
    expect(out.some((p) => p.x === 10 && p.y === 0)).toBe(false); // the corner is cut
  });
});

describe('riverStroke', () => {
  const W = 30;
  const line = [{ x: 2, y: 15.5 }, { x: 28, y: 15.5 }]; // along the middle of pixel row 15

  it('covers the pixels along the line, strongest on the centre line', () => {
    const wet = riverStroke(line, W, W, () => 4);
    expect(wet.get(15 * W + 10)).toBeGreaterThan(0.8);
    expect(wet.get(14 * W + 10)!).toBeLessThan(wet.get(15 * W + 10)!);
    expect(wet.has(5 * W + 10)).toBe(false);
  });

  it('widens as it goes when the width grows along the path', () => {
    const wet = riverStroke(line, W, W, (t) => 2 + 8 * t);
    const across = (x: number) => [...Array(W).keys()].filter((y) => wet.has(y * W + x)).length;
    expect(across(25)).toBeGreaterThan(across(5));
  });
});
