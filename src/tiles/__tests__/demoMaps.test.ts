import { describe, expect, it } from 'vitest';
import { coverAt, elevationAt, type CoverGrid } from '../coverGrid';
import { DEMO_MAPS, ELEVATION_BAND_ROW, LEVEL_BANDS, NATURAL_SLOPE, demoMap, floodedGrid, gentleSlopes } from '../demoMaps';
import { neighbourIndices } from '../hydrology';
import { HIGH_LAKE_FROM } from '../shores';
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

/** The map as it looks with rain filling its high basins. */
const full = (id: string, seed: number) => {
  const map = demoMap(id, seed);
  return floodedGrid(map.grid, map.water);
};

describe('highlands', () => {
  for (const seed of [1, 5, 9]) {
    const grid = full('highlands', seed);
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

describe('mountains (random)', () => {
  /** Each lake's surface level: connected lake cells above the sea, which all share one elevation. */
  const lakeLevels = (grid: CoverGrid) => {
    const isLake = (i: number) => grid.cells[i].water >= 2 && grid.elevation[i] > 0.5;
    const seen = new Set<number>();
    const levels: number[] = [];
    grid.cells.forEach((_, start) => {
      if (seen.has(start) || !isLake(start)) return;
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const i = stack.pop()!;
        const [col, row] = [i % grid.cols, Math.floor(i / grid.cols)];
        for (const d of offsetNeighbours(row)) {
          const [c, r] = [col + d.dc, row + d.dr];
          const j = r * grid.cols + c;
          if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows || seen.has(j) || !isLake(j)) continue;
          expect(grid.elevation[j]).toBeCloseTo(grid.elevation[start], 6); // a lake is level
          seen.add(j);
          stack.push(j);
        }
      }
      levels.push(grid.elevation[start]);
    });
    return levels;
  };

  const seeds = [1, 2, 3, 4, 5].map((seed) => {
    const grid = full('mountains', seed);
    return { seed, grid, levels: lakeLevels(grid) };
  });

  for (const { seed, grid, levels } of seeds) {
    it(`has high mountains (seed ${seed})`, () => {
      expect(Math.max(...grid.elevation)).toBeGreaterThanOrEqual(MAX_ELEVATION - 1);
    });

    it(`holds a lake high in the mountains (seed ${seed})`, () => {
      expect(Math.max(...levels)).toBeGreaterThanOrEqual(4);
    });
  }

  it('holds lakes at clearly different heights, from the foothills to the snow, as a rule', () => {
    expect(seeds.filter(({ levels }) => levels.length >= 2 && Math.max(...levels) - Math.min(...levels) >= 1.5).length).toBeGreaterThanOrEqual(3);
    expect(seeds.some(({ levels }) => Math.max(...levels) >= 6.5)).toBe(true);
  });

  it('is different for every seed', () => {
    expect(demoMap('mountains', 1).grid.elevation).not.toEqual(demoMap('mountains', 2).grid.elevation);
  });
});

describe('natural slopes', () => {
  it('rises gradually everywhere: no hex stands more than a natural slope above its neighbour', () => {
    for (const [id, seed] of [['highlands', 1], ['highlands', 9], ['mountains', 2], ['mountains', 4]] as const) {
      const { grid } = demoMap(id, seed);
      const ground = grid.elevation;
      for (let i = 0; i < ground.length; i++) for (const j of neighbourIndices(grid, i)) expect(ground[i] - ground[j]).toBeLessThanOrEqual(NATURAL_SLOPE + 1e-6);
    }
  });

  it('lowers what is too steep and keeps low ground as it is', () => {
    expect(gentleSlopes(3, 1, [0, 8, 1])).toEqual([0, NATURAL_SLOPE, 1]);
  });
});

describe('high basins', () => {
  const { grid, water } = demoMap('highlands', 1);
  const basin = water!.map((d, i) => (d > 0 ? i : -1)).filter((i) => i >= 0);

  it('keeps their water apart from the map, over dry ground at its true height', () => {
    expect(basin.length).toBeGreaterThan(3);
    for (const i of basin) expect(grid.cells[i].water).toBeLessThan(2);
    const floor = basin.map((i) => grid.elevation[i]);
    expect(Math.max(...floor) - Math.min(...floor)).toBeGreaterThan(0.5); // a bowl, not a flat lake bed
  });

  it('holds water up to one level over every cell of a basin', () => {
    const surface = basin.map((i) => grid.elevation[i] + water![i]);
    expect(Math.max(...surface) - Math.min(...surface)).toBeLessThan(1e-6);
    expect(surface[0]).toBeGreaterThanOrEqual(HIGH_LAKE_FROM);
  });

  it('puts the water back as a level lake on the flooded map', () => {
    const flooded = floodedGrid(grid, water);
    const deepest = basin.reduce((a, b) => (water![b] > water![a] ? b : a));
    expect(flooded.cells[deepest].water).toBeGreaterThanOrEqual(2);
    expect(flooded.elevation[deepest]).toBeCloseTo(grid.elevation[deepest] + water![deepest], 6);
  });
});

describe('DEMO_MAPS', () => {
  it('builds every registered map', () => {
    for (const def of DEMO_MAPS) expect(def.build(1).grid.cells.length).toBeGreaterThan(0);
  });
});
