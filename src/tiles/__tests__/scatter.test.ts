import { describe, expect, it } from 'vitest';
import { offsetToPixel, pixelToOffset } from '../../math/hex';
import { createCoverGrid, inGrid } from '../coverGrid';
import { PROP_KINDS, PROP_RULES, byLevel, type PropRule } from '../propRules';
import { scatterProps } from '../scatter';
import { createTerrainSampler } from '../terrainSampler';
import { MAX_ELEVATION, type Cover } from '../levels';
import { ROCK_LINE } from '../groundShader';

const SIZE = 30;
const TREE: PropRule = {
  kind: 'tree',
  count: byLevel('trees', [0, 1, 3, 6, 10]),
  prefer: 'trees',
  spacing: 0.3,
  fits: (a) => a.water < 0.36,
};

// Bare sand | first tree | dense forest.
const COVERS: Partial<Cover>[] = [{}, { trees: 1 }, { trees: 4 }];
const grid = createCoverGrid(COVERS.length, 1, (col) => COVERS[col]);
const sampler = createTerrainSampler(grid, SIZE, 0.6, 7);
const scatter = (seed: number) => scatterProps(grid, sampler, [TREE], SIZE, seed);
const inHex = (col: number) => scatter(1).filter((p) => pixelToOffset(p.x, p.y, SIZE).col === col);

describe('scatterProps', () => {
  it('places exactly the level count when there is room', () => {
    expect(inHex(0)).toHaveLength(0);
    expect(inHex(1)).toHaveLength(1);
  });

  it('packs a dense forest with many trees', () => {
    expect(inHex(2).length).toBeGreaterThanOrEqual(6);
  });

  it('skips spots where the rule does not fit', () => {
    const drowned = createCoverGrid(2, 2, () => ({ trees: 4, water: 4 }));
    const s = createTerrainSampler(drowned, SIZE, 0.6, 7);
    expect(scatterProps(drowned, s, [TREE], SIZE, 1)).toHaveLength(0);
  });

  it('keeps every prop on the map', () => {
    const props = scatter(1);
    expect(props.length).toBeGreaterThan(0);
    for (const p of props) {
      const h = pixelToOffset(p.x, p.y, SIZE);
      expect(inGrid(grid, h.col, h.row)).toBe(true);
    }
  });

  it('respects the minimum spacing within a hex', () => {
    const trees = inHex(2);
    for (const a of trees) {
      for (const b of trees) {
        if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(TREE.spacing * SIZE);
      }
    }
  });

  it('is deterministic per seed and varies between seeds', () => {
    expect(scatter(3)).toEqual(scatter(3));
    expect(scatter(3)).not.toEqual(scatter(4));
  });

  it('leans a lone first tree toward the denser neighbour', () => {
    const centre = offsetToPixel(1, 0, SIZE);
    let towardForest = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const tree = scatter(seed).find((p) => pixelToOffset(p.x, p.y, SIZE).col === 1)!;
      if (tree.x > centre.x) towardForest++;
    }
    expect(towardForest).toBeGreaterThanOrEqual(15);
  });
});

describe('scatterProps rule options', () => {
  const flat = createCoverGrid(3, 1, () => ({ elevation: 6 }));
  const s = createTerrainSampler(flat, SIZE, 0.6, 7);
  const ONE: PropRule = { kind: 'peak', count: () => 1, spacing: 0.5, fits: () => true };

  it('records the hex each prop belongs to', () => {
    const props = scatterProps(flat, s, [ONE], SIZE, 1);
    expect(props.map((p) => p.col)).toEqual([0, 1, 2]);
    expect(props.every((p) => p.row === 0)).toBe(true);
  });

  it('skips a hex entirely when its chance roll fails', () => {
    expect(scatterProps(flat, s, [{ ...ONE, chance: 0 }], SIZE, 1)).toHaveLength(0);
  });

  it('keeps centred props close to the hex centre', () => {
    for (const p of scatterProps(flat, s, [{ ...ONE, centred: true }], SIZE, 1)) {
      const c = offsetToPixel(p.col, p.row, SIZE);
      expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeLessThanOrEqual(0.2 * SIZE);
    }
  });

  it('passes elevation to the count', () => {
    const byHeight: PropRule = { ...ONE, count: (_, e) => (e >= 6 ? 1 : 0) };
    expect(scatterProps(flat, s, [byHeight], SIZE, 1)).toHaveLength(3);
    expect(scatterProps(grid, sampler, [byHeight], SIZE, 1)).toHaveLength(0);
  });
});

describe('PROP_RULES', () => {
  it('only uses known prop kinds', () => {
    for (const rule of PROP_RULES) expect(PROP_KINDS).toContain(rule.kind);
  });

  const empty: Cover = { water: 0, grass: 0, trees: 0 };
  const rule = (kind: string) => PROP_RULES.find((r) => r.kind === kind)!;

  it('places nothing on a completely empty hex except beach pebbles', () => {
    const kinds = PROP_RULES.filter((r) => r.count(empty, 0) > 0).map((r) => r.kind);
    expect(kinds).toEqual(['pebble']);
  });

  it('leaves mountains to the ridges: no peak sprites, boulders only on the foothills', () => {
    expect(PROP_RULES.some((r) => r.kind === 'peak')).toBe(false);
    expect(rule('boulder').count(empty, 3.2)).toBe(1);
    expect(rule('boulder').count(empty, MAX_ELEVATION)).toBe(0);
  });

  it('grows reeds only along lowland water, never around a mountain lake', () => {
    expect(rule('reed').fits({ water: 0.4, grass: 0, trees: 0, alt: 0.1 })).toBe(true);
    expect(rule('reed').fits({ water: 0.4, grass: 0, trees: 0, alt: 0.75 })).toBe(false);
  });

  it('keeps trees off bare rock', () => {
    expect(rule('tree').fits({ water: 0, grass: 1, trees: 1, alt: ROCK_LINE[1] })).toBe(false);
    expect(rule('tree').fits({ water: 0, grass: 1, trees: 1, alt: 0.2 })).toBe(true);
  });
});
