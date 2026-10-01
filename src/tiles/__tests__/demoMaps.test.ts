import { describe, expect, it } from 'vitest';
import { coverAt, elevationAt, type CoverGrid } from '../coverGrid';
import { DEMO_MAPS, ELEVATION_BAND_ROW, LEVEL_BANDS, demoMap } from '../demoMaps';
import { LAYERS, MAX_ELEVATION, MAX_LEVEL } from '../levels';
import { offsetNeighbours } from '../../math/hex';

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

  it('raises the last band in steps of two terraces', () => {
    for (let g = 0; g <= MAX_LEVEL; g++) expect(elevationAt(grid, g * 3 + 1, ELEVATION_BAND_ROW + 1)).toBe(g * 2);
  });

  it('labels each level once', () => {
    expect(labels).toHaveLength((LEVEL_BANDS.length + 1) * (MAX_LEVEL + 1));
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

describe('highlands', () => {
  for (const seed of [1, 5, 9]) {
    const { grid } = demoMap('highlands', seed);
    const cells = grid.cells.map((c, i) => ({ ...c, elevation: grid.elevation[i], i }));
    const lake = cells.filter((c) => c.water >= 2 && c.elevation >= 3);

    it(`climbs to snowy heights (seed ${seed})`, () => {
      expect(Math.max(...grid.elevation)).toBeGreaterThanOrEqual(MAX_ELEVATION - 1);
    });

    it(`holds a high lake in a mountain basin, with a notch where it overflows (seed ${seed})`, () => {
      expect(lake.length).toBeGreaterThanOrEqual(2);
      const surface = lake[0].elevation;
      const inLake = new Set(lake.filter((c) => c.elevation === surface).map((c) => c.i));
      const rim = [...inLake].flatMap((i) => {
        const col = i % grid.cols;
        const row = Math.floor(i / grid.cols);
        return offsetNeighbours(row)
          .map((d) => [col + d.dc, row + d.dr])
          .filter(([c, r]) => c >= 0 && r >= 0 && c < grid.cols && r < grid.rows)
          .map(([c, r]) => r * grid.cols + c)
          .filter((j) => !inLake.has(j))
          .map((j) => grid.elevation[j]);
      });
      expect(Math.min(...rim)).toBeGreaterThanOrEqual(surface - 1e-6);
      expect(Math.min(...rim)).toBeLessThan(surface + 0.75);
      expect(Math.max(...rim)).toBeGreaterThan(surface + 0.75);
    });

    it(`keeps forests below the tree line (seed ${seed})`, () => {
      expect(cells.filter((c) => c.trees > 0 && c.elevation > 4.5)).toHaveLength(0);
    });
  }
});

describe('DEMO_MAPS', () => {
  it('builds every registered map', () => {
    for (const def of DEMO_MAPS) expect(def.build(1).grid.cells.length).toBeGreaterThan(0);
  });
});
