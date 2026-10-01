import { describe, expect, it } from 'vitest';
import { offsetNeighbours, pixelToOffset } from '../../math/hex';
import { elevationAt } from '../coverGrid';
import { demoMap } from '../demoMaps';
import { gridFrame } from '../geometry';
import { composeTerrain } from '../groundComposer';
import { createPlaceholderTextures } from '../placeholderTextures';
import { createTerrainSampler } from '../terrainSampler';

const SIZE = 14;
const { grid } = demoMap('highlands', 1);
const frame = gridFrame(grid.cols, grid.rows, SIZE);
const compose = (style: 'relief' | 'sprites') =>
  composeTerrain(createTerrainSampler(grid, SIZE, 0.6, 3), grid, createPlaceholderTextures(32), frame, SIZE, 3, { height: 30, style });

describe('composeTerrain', () => {
  for (const style of ['relief', 'sprites'] as const) {
    const t = compose(style);
    const fallIdx = [...t.falls.keys()].filter((i) => t.falls[i]);

    it(`marks a waterfall where the high lake pours out (${style})`, () => {
      expect(fallIdx.length).toBeGreaterThan(0);
      for (const i of fallIdx) expect(t.heights[i]).toBeGreaterThan(0);
    });

    it(`keeps the waterfall to one spot, not the whole shore (${style})`, () => {
      const xs = fallIdx.map((i) => i % frame.width);
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(2 * SIZE);
    });
  }

  it('raises only the high lake and the land around it at or above its level, in sprite style', () => {
    const t = compose('sprites');
    const lakeLevel = Math.max(...grid.cells.map((c, i) => (c.water >= 2 ? grid.elevation[i] : 0)));
    const high = (c: number, r: number) => (elevationAt(grid, c, r) ?? 0) >= lakeLevel - 0.6;
    const nearHigh = (c: number, r: number) => high(c, r) || offsetNeighbours(r).some((d) => high(c + d.dc, r + d.dr));
    const raised = [...t.heights.keys()].filter((i) => t.heights[i] > 0);
    expect(raised.length).toBeGreaterThan(0);
    for (const i of raised) {
      const hex = pixelToOffset((i % frame.width) + 0.5 - frame.ox, Math.floor(i / frame.width) + 0.5 - frame.oy, SIZE);
      expect(nearHigh(hex.col, hex.row)).toBe(true);
    }
  });
});
