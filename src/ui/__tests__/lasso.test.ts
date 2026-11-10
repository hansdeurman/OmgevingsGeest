import { describe, expect, it } from 'vitest';
import { cellsIn, closeLasso, crossing, inside } from '../lasso';

const p = (x: number, y: number) => ({ x, y });

describe('crossing', () => {
  it('finds where two segments cross, as shares along each', () => {
    expect(crossing(p(0, 0), p(2, 0), p(1, -1), p(1, 3))).toEqual({ t: 0.5, u: 0.25 });
  });

  it('finds none where they miss each other or run side by side', () => {
    expect(crossing(p(0, 0), p(1, 0), p(2, -1), p(2, 1))).toBeUndefined();
    expect(crossing(p(0, 0), p(1, 0), p(0, 1), p(1, 1))).toBeUndefined();
  });
});

describe('closeLasso', () => {
  it('joins the ends of a stroke that never crosses itself with a straight line', () => {
    const stroke = [p(0, 0), p(4, 0), p(4, 4), p(0, 4)];
    expect(closeLasso(stroke)).toEqual(stroke);
  });

  it('takes the loop at the crossing of a stroke drawn on past its start, leaving the tail off', () => {
    // Round a square from its top, on past where it began, down the left side again.
    const stroke = [p(1, -1), p(1, 4), p(4, 4), p(4, 1), p(-1, 1), p(-2, 1)];
    const loop = closeLasso(stroke);
    expect(loop[0].x).toBeCloseTo(1);
    expect(loop[0].y).toBeCloseTo(1);
    expect(loop.slice(1)).toEqual([p(1, 4), p(4, 4), p(4, 1)]);
  });

  it('takes the last of several crossings', () => {
    // A small loop first, then a big one.
    const stroke = [p(0, 0), p(2, 0), p(2, 2), p(1, 2), p(1, -1), p(10, -1), p(10, 10), p(0.5, 10), p(0.5, -3)];
    const loop = closeLasso(stroke);
    expect(loop.some((q) => q.x === 10)).toBe(true);
    expect(loop[0].x).toBeCloseTo(0.5);
  });
});

describe('inside', () => {
  const square = [p(0, 0), p(4, 0), p(4, 4), p(0, 4)];
  it('tells points inside an outline from those outside, its last point joined to its first', () => {
    expect(inside(square, p(2, 2))).toBe(true);
    expect(inside(square, p(5, 2))).toBe(false);
    expect(inside([p(0, 0), p(4, 0), p(0, 4)], p(3, 3))).toBe(false);
  });
});

describe('cellsIn', () => {
  it('chooses the hexes whose middles lie inside, none for a line', () => {
    const centre = (i: number) => p(i % 5, Math.floor(i / 5));
    expect(cellsIn([p(0.5, 0.5), p(2.5, 0.5), p(2.5, 2.5), p(0.5, 2.5)], 25, centre)).toEqual([6, 7, 11, 12]);
    expect(cellsIn([p(0, 0), p(4, 4)], 25, centre)).toEqual([]);
  });
});
