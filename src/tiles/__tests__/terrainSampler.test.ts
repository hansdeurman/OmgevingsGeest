import { describe, expect, it } from 'vitest';
import { offsetToPixel } from '../../math/hex';
import { createCoverGrid } from '../coverGrid';
import { WOBBLE, createTerrainSampler } from '../terrainSampler';

const SIZE = 20;
const grid = createCoverGrid(3, 1, (col) => ({ grass: ([0, 2, 4] as const)[col] }));
const sampler = createTerrainSampler(grid, SIZE, 0.6, 42);
const centre = (col: number) => offsetToPixel(col, 0, SIZE);

describe('createTerrainSampler', () => {
  it('is deterministic for a seed', () => {
    const other = createTerrainSampler(grid, SIZE, 0.6, 42);
    expect(other.sample(13.3, 2.1)).toEqual(sampler.sample(13.3, 2.1));
  });

  it('keeps an empty hex perfectly clean at its centre', () => {
    const c = centre(0);
    for (const v of Object.values(sampler.sample(c.x, c.y))) expect(v).toBeLessThan(1e-3);
  });

  it('wobbles a covered hex around its level, within the wobble amplitude', () => {
    const c = centre(1);
    const g = sampler.sample(c.x, c.y).grass;
    expect(Math.abs(g - 0.5)).toBeLessThanOrEqual(WOBBLE.grass + 1e-3);
  });

  it('makes the boundary between hexes organic rather than straight', () => {
    const x = (centre(1).x + centre(2).x) / 2;
    const values = Array.from({ length: 12 }, (_, i) => sampler.sample(x, -SIZE / 2 + i * 1.7).grass);
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.05);
  });
});
