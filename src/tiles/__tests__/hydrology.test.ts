import { describe, expect, it } from 'vitest';
import { fillDepressions, spillPoint } from '../hydrology';

/** Build a cols×rows elevation array from row strings of digits. */
const grid = (...rows: string[]) => ({
  cols: rows[0].length,
  rows: rows.length,
  elevation: rows.flatMap((r) => [...r].map(Number)),
});

describe('fillDepressions', () => {
  it('leaves terrain that drains to the edge untouched', () => {
    const g = grid('0000', '0120', '0000');
    expect(fillDepressions(g)).toEqual(g.elevation);
  });

  it('fills a closed bowl up to its rim', () => {
    const g = grid('00000', '05550', '05250', '05550', '00000');
    const level = fillDepressions(g);
    expect(level[2 * 5 + 2]).toBe(5);
  });

  it('fills only up to the lowest notch in the rim', () => {
    const g = grid('00000', '05550', '05250', '05350', '00000');
    expect(fillDepressions(g)[2 * 5 + 2]).toBe(3);
  });

  it('never lowers terrain', () => {
    const g = grid('31413', '59265', '35897', '93238');
    fillDepressions(g).forEach((l, i) => expect(l).toBeGreaterThanOrEqual(g.elevation[i]));
  });
});

describe('spillPoint', () => {
  it('finds where a lake overflows: the lowest rim cell next to it', () => {
    const g = grid('00000', '05550', '05250', '05350', '00000');
    const level = fillDepressions(g);
    expect(spillPoint(g, level, 2 * 5 + 2)).toEqual({ index: 3 * 5 + 2, level: 3 });
  });
});
