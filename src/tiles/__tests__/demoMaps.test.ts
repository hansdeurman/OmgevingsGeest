import { describe, expect, it } from 'vitest';
import { coverAt, type CoverGrid } from '../coverGrid';
import { DEMO_MAPS, LEVEL_BANDS, demoMap } from '../demoMaps';
import { LAYERS, MAX_LEVEL } from '../levels';

const count = (grid: CoverGrid, pred: (c: CoverGrid['cells'][number]) => boolean) => grid.cells.filter(pred).length;

describe('levels showcase', () => {
  const { grid, labels } = demoMap('levels', 1);

  it('lays out every level of every layer, left to right', () => {
    for (const band of LEVEL_BANDS) {
      for (let level = 0; level <= MAX_LEVEL; level++) {
        const cover = coverAt(grid, level * 3 + 1, band.row + 1)!;
        for (const layer of LAYERS) expect(cover[layer]).toBe(layer === band.layer ? level : 0);
      }
    }
  });

  it('labels each level once', () => {
    expect(labels).toHaveLength(LEVEL_BANDS.length * (MAX_LEVEL + 1));
  });
});

describe('island', () => {
  it('is deterministic per seed and differs between seeds', () => {
    expect(demoMap('island', 5).grid).toEqual(demoMap('island', 5).grid);
    expect(demoMap('island', 5).grid).not.toEqual(demoMap('island', 6).grid);
  });

  it('has deep sea, open sand, meadow and dense forest', () => {
    const { grid } = demoMap('island', 5);
    expect(count(grid, (c) => c.water === 4)).toBeGreaterThan(10);
    expect(count(grid, (c) => c.water + c.grass + c.trees === 0)).toBeGreaterThan(3);
    expect(count(grid, (c) => c.grass >= 3)).toBeGreaterThan(5);
    expect(count(grid, (c) => c.trees === 4)).toBeGreaterThan(2);
  });

  it('never grows grass or trees in open water', () => {
    const { grid } = demoMap('island', 5);
    expect(count(grid, (c) => c.water >= 2 && c.grass + c.trees > 0)).toBe(0);
  });
});

describe('DEMO_MAPS', () => {
  it('builds every registered map', () => {
    for (const def of DEMO_MAPS) expect(def.build(1).grid.cells.length).toBeGreaterThan(0);
  });
});
