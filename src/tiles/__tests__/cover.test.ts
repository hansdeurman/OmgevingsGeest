import { describe, expect, it } from 'vitest';
import { LAYERS, LEVEL_NAMES, MAX_LEVEL, levelAmount } from '../levels';
import { coverAt, createCoverGrid, forEachCell } from '../coverGrid';

describe('levels', () => {
  it('maps levels linearly onto [0, 1]', () => {
    expect(levelAmount(0)).toBe(0);
    expect(levelAmount(2)).toBe(0.5);
    expect(levelAmount(MAX_LEVEL)).toBe(1);
  });

  it('names every level of every layer', () => {
    for (const layer of LAYERS) expect(LEVEL_NAMES[layer]).toHaveLength(MAX_LEVEL + 1);
  });
});

describe('coverGrid', () => {
  const grid = createCoverGrid(3, 2, (col, row) => ({ grass: col as 0 | 1 | 2, trees: row as 0 | 1 }));

  it('fills cells from the initialiser and defaults the rest to 0', () => {
    expect(coverAt(grid, 2, 1)).toEqual({ water: 0, grass: 2, trees: 1 });
  });

  it('returns undefined outside the grid', () => {
    expect(coverAt(grid, 3, 0)).toBeUndefined();
    expect(coverAt(grid, 0, -1)).toBeUndefined();
  });

  it('visits every cell in row-major order', () => {
    const seen: string[] = [];
    forEachCell(grid, (_, col, row) => seen.push(`${col},${row}`));
    expect(seen).toEqual(['0,0', '1,0', '2,0', '0,1', '1,1', '2,1']);
  });
});
