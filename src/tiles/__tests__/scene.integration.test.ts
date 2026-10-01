import { describe, expect, it } from 'vitest';
import { pixelToOffset } from '../../math/hex';
import { coverAt } from '../coverGrid';
import { LEVEL_BANDS, demoMap } from '../demoMaps';
import { frameCentre } from '../geometry';
import { createPlaceholderTextures } from '../placeholderTextures';
import { getPixel } from '../raster';
import { buildScene } from '../scene';

/**
 * End-to-end: demo map → terrain sampler → ground image + scattered props +
 * slab sides. Checks the composed result the way a viewer would read it.
 */
const SIZE = 16;
const view = { squash: 0.7, thickness: 4 };
const { grid } = demoMap('levels', 1);
const scene = buildScene(grid, createPlaceholderTextures(32), { hexSize: SIZE, seed: 3, blend: 0.6, view });

const pixelAtHex = (col: number, row: number) => {
  const c = frameCentre(col, row, SIZE, scene.frame);
  return getPixel(scene.ground, Math.round(c.x), Math.round(c.y));
};
/** Hex under a prop's iso foot. */
const hexOf = (p: { x: number; y: number }) =>
  pixelToOffset(p.x - scene.frame.ox, p.y / view.squash - scene.frame.oy, SIZE);
const band = (layer: string) => LEVEL_BANDS.find((b) => b.layer === layer)!.row + 1;
const levelCol = (level: number) => level * 3 + 1;

describe('buildScene (levels showcase)', () => {
  it('produces a ground image the size of the map frame', () => {
    expect([scene.ground.width, scene.ground.height]).toEqual([scene.frame.width, scene.frame.height]);
  });

  it('is opaque on every hex and transparent off the map', () => {
    for (const c of scene.centres) expect(getPixel(scene.ground, Math.round(c.x), Math.round(c.y))[3]).toBe(255);
    expect(getPixel(scene.ground, 0, 0)[3]).toBe(0);
  });

  it('reads as sand, deep water, meadow and forest at the extremes', () => {
    const [sr, , sb] = pixelAtHex(levelCol(0), band('water'));
    expect(sr).toBeGreaterThan(sb + 40);
    const [wr, , wb] = pixelAtHex(levelCol(4), band('water'));
    expect(wb).toBeGreaterThan(wr + 60);
    const [gr, gg, gb] = pixelAtHex(levelCol(4), band('grass'));
    expect(gg).toBeGreaterThan(Math.max(gr, gb));
    const [fr, fg, fb] = pixelAtHex(levelCol(4), band('trees'));
    expect(fg).toBeGreaterThan(Math.max(fr, fb));
    expect(fg).toBeLessThan(gg);
  });

  it('turns tree levels into counts: none, one first tree, then ever more', () => {
    const treesIn = (level: number) =>
      scene.props.filter((p) => {
        const h = hexOf(p);
        return p.kind === 'tree' && h.col === levelCol(level) && h.row === band('trees');
      }).length;
    expect(treesIn(0)).toBe(0);
    expect(treesIn(1)).toBe(1);
    expect(treesIn(2)).toBe(3);
    expect(treesIn(4)).toBeGreaterThan(treesIn(2));
  });

  it('never stands a tree or bush in water', () => {
    for (const p of scene.props.filter((q) => q.kind === 'tree' || q.kind === 'bush')) {
      const h = hexOf(p);
      expect(coverAt(grid, h.col, h.row)!.water).toBeLessThan(2);
    }
  });

  it('sorts props back to front', () => {
    for (let i = 1; i < scene.props.length; i++) expect(scene.props[i].y).toBeGreaterThanOrEqual(scene.props[i - 1].y);
  });

  it('gives every hex two coloured front faces', () => {
    expect(scene.sides).toHaveLength(grid.cells.length * 2);
    expect(scene.sides.every((s) => s.points.length === 4 && s.color.every(Number.isFinite))).toBe(true);
  });
});
