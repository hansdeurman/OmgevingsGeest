import { describe, expect, it } from 'vitest';
import { pixelToOffset } from '../../math/hex';
import { coverAt } from '../coverGrid';
import { demoMap } from '../demoMaps';
import { gridFrame } from '../geometry';
import { composeTerrain } from '../groundComposer';
import { createPlaceholderTextures } from '../placeholderTextures';
import type { ReliefOptions } from '../relief';
import { createTerrainSampler } from '../terrainSampler';

const SIZE = 14;
const { grid } = demoMap('highlands', 1);
const frame = gridFrame(grid.cols, grid.rows, SIZE);
const compose = (relief: ReliefOptions) =>
  composeTerrain(createTerrainSampler(grid, SIZE, 0.6, 3), grid, createPlaceholderTextures(32), frame, SIZE, 3, relief);
const hexOf = (i: number) => pixelToOffset((i % frame.width) + 0.5 - frame.ox, Math.floor(i / frame.width) + 0.5 - frame.oy, SIZE);

describe('composeTerrain (relief style)', () => {
  const t = compose({ height: 30, style: 'relief' });
  const fallIdx = [...t.falls.keys()].filter((i) => t.falls[i]);

  it('marks a waterfall where the raised lake pours out, kept to one spot', () => {
    expect(fallIdx.length).toBeGreaterThan(0);
    for (const i of fallIdx) expect(t.heights[i]).toBeGreaterThan(0);
    const xs = fallIdx.map((i) => i % frame.width);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(2 * SIZE);
  });
});

describe('composeTerrain (flat map)', () => {
  const t = compose({ height: 30, style: 'sprites' });

  it('raises nothing, so nothing hides what lies behind it', () => {
    expect(t.heights.every((h) => h === 0)).toBe(true);
  });

  it('shows height as hillshade: the mountains are shaded, the open sea is not', () => {
    const plain = compose({ height: 0, style: 'sprites' });
    const differs = (i: number) => [0, 1, 2].some((k) => t.ground.data[i * 4 + k] !== plain.ground.data[i * 4 + k]);
    const mountain = [...t.heights.keys()].filter((i) => t.rows[i] >= 0 && (grid.elevation[hexOf(i).row * grid.cols + hexOf(i).col] ?? 0) >= 6.5);
    expect(mountain.filter(differs).length / mountain.length).toBeGreaterThan(0.5);
    const sea = [...t.heights.keys()].filter((i) => t.rows[i] >= 0 && (coverAt(grid, hexOf(i).col, hexOf(i).row)?.water ?? 0) >= 4 && !t.river[i]); // deep sea, away from the coast
    expect(sea.filter(differs).length).toBeLessThan(0.02 * sea.length); // only right along the coast
  });

  it('paints a river from the high lake down to the sea, with a cascade where it drops', () => {
    expect(t.rivers).toHaveLength(1);
    const cells = t.rivers[0].cells;
    const last = grid.cells[cells[cells.length - 1]];
    expect(last.water).toBeGreaterThanOrEqual(2);
    expect(grid.elevation[cells[cells.length - 1]]).toBeLessThanOrEqual(0.5);
    expect(t.river.some(Boolean)).toBe(true);
    expect(t.cascades.length).toBeGreaterThan(0);
  });

  it('draws height lines only when asked', () => {
    const lines = compose({ height: 30, style: 'sprites', contours: true });
    const changed = [...lines.ground.data.keys()].filter((k) => lines.ground.data[k] !== t.ground.data[k]);
    expect(changed.length).toBeGreaterThan(0);
  });
});
