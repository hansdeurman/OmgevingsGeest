import { describe, expect, it } from 'vitest';
import { closest, countIn, countNear, createCensus, middleOf, nearby, takeCensus } from '../census';
import { centreOf } from '../hexSpace';

const [cols, rows] = [8, 6];
const at = (i: number, kind = 0) => ({ ...centreOf(cols, i), kind });

describe('takeCensus', () => {
  const creatures = [at(9), at(9, 1), at(10), at(40)];
  const census = createCensus(cols, rows);
  takeCensus(census, creatures);

  it('counts the creatures on each hex', () => {
    expect([census.crowd[9], census.crowd[10], census.crowd[40], census.crowd[0]]).toEqual([2, 1, 1, 0]);
    expect(countIn(census, 9)).toBe(2);
    expect([countIn(census, 9, 0), countIn(census, 9, 1), countIn(census, 10, 1)]).toEqual([1, 1, 0]);
  });

  it('finds those near a point, nearest first, and none beyond the reach', () => {
    const { x, y } = centreOf(cols, 9);
    expect(nearby(census, creatures, x, y, 1.2)).toEqual([0, 1, 2]);
    expect(nearby(census, creatures, x + 0.9, y, 1.2)).toEqual([2, 0, 1]);
    expect(nearby(census, creatures, x, y, 0.5, (k) => creatures[k].kind === 1)).toEqual([1]);
    expect(nearby(census, creatures, 0, 0, 0.4)).toEqual([]);
  });

  it('finds the nearest of some kinds only, counts those near, and where a kind is on average', () => {
    const { x, y } = centreOf(cols, 9);
    expect(closest(census, creatures, x, y, 2, () => true, [1])).toBe(1);
    expect(closest(census, creatures, x, y, 2, (k) => k !== 1, [1])).toBe(-1);
    expect(countNear(census, creatures, x, y, 1.2)).toBe(3);
    const mid = middleOf(census, x, y, 2, 0);
    expect(mid.count).toBe(2);
    expect(mid.x).toBeCloseTo((centreOf(cols, 9).x + centreOf(cols, 10).x) / 2);
    expect(middleOf(census, 6, 4, 1, 1)).toEqual({ x: 6, y: 4, count: 0 });
  });

  it('starts afresh each time', () => {
    takeCensus(census, [at(0)]);
    expect([census.crowd[9], census.crowd[0]]).toEqual([0, 1]);
  });
});
