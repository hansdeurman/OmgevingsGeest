import { describe, expect, it } from 'vitest';
import { createCoverGrid, growTrees } from '../coverGrid';

describe('growTrees', () => {
  it('sets the trees on the cells, and tells whether any changed', () => {
    const grid = createCoverGrid(3, 1, (col) => ({ grass: 2, trees: col === 0 ? 1 : 0 }));
    expect(growTrees(grid, [1, 0, 0])).toBe(false);
    expect(growTrees(grid, Float32Array.from([0, 4, 0]))).toBe(true);
    expect(grid.cells.map((c) => c.trees)).toEqual([0, 4, 0]);
    expect(grid.cells.map((c) => c.grass)).toEqual([2, 2, 2]);
  });
});
