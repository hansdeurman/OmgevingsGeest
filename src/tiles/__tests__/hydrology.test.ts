import { describe, expect, it } from 'vitest';
import { fillDepressions, lakeOutlets, spillPoint } from '../hydrology';

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

describe('lakeOutlets', () => {
  it('finds each lake, and the lake cell and lower neighbour where it pours out', () => {
    // Two-cell lake (the 5s) inside a rim of 7s, with a notch of 3 just below it.
    const g = grid('000000', '077770', '075570', '077370', '000000');
    const lakes = lakeOutlets(g, (i) => i === 14 || i === 15);
    expect(lakes).toHaveLength(1);
    expect(lakes[0].cells.sort()).toEqual([14, 15]);
    expect(lakes[0].to).toBe(21);
    expect(lakes[0].from).toBe(15);
  });

  it('pours out past the shore that lies at the lake level, not into it', () => {
    // Lake (14) with a level shore cell (15) at the same 5, rim of 7s, notch of 3 below the shore.
    const g = grid('000000', '077770', '075570', '077370', '000000');
    const [lake] = lakeOutlets(g, (i) => i === 14);
    expect(lake.cells).toEqual([14]);
    expect(lake.from).toBe(15);
    expect(lake.to).toBe(21);
  });

  it('separates lakes that do not touch', () => {
    const g = grid('0000000', '0505050', '0000000');
    expect(lakeOutlets(g, (i) => i === 8 || i === 12)).toHaveLength(2);
  });
});
