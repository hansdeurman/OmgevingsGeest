import { describe, expect, it } from 'vitest';
import { coverAt, elevationAt, forEachCell } from '../coverGrid';
import { LEVEL_BANDS, demoMap } from '../demoMaps';
import { frameCentre } from '../geometry';
import { createPlaceholderTextures } from '../placeholderTextures';
import { getPixel } from '../raster';
import { buildScene } from '../scene';

/**
 * End-to-end: demo map → terrain sampler → ground image + scattered props +
 * lifted tiles with walls. Checks the composed result the way a viewer would read it.
 */
const SIZE = 16;
const view = { squash: 0.7, thickness: 4, step: 5 };
const textures = createPlaceholderTextures(32);
const build = (id: string) => {
  const { grid } = demoMap(id, 1);
  return { grid, scene: buildScene(grid, textures, { hexSize: SIZE, seed: 3, blend: 0.6, view }) };
};
const { grid, scene } = build('levels');
const props = scene.rows.flatMap((r) => r.props);

const pixelAtHex = (col: number, row: number) => {
  const c = frameCentre(col, row, SIZE, scene.frame);
  return getPixel(scene.ground, Math.round(c.x), Math.round(c.y));
};
const band = (layer: string) => LEVEL_BANDS.find((b) => b.layer === layer)!.row + 1;
const levelCol = (level: number) => level * 3 + 1;

describe('buildScene (levels showcase)', () => {
  it('produces a ground image the size of the map frame', () => {
    expect([scene.ground.width, scene.ground.height]).toEqual([scene.frame.width, scene.frame.height]);
  });

  it('is opaque on every hex and transparent off the map', () => {
    forEachCell(grid, (_, col, row) => expect(pixelAtHex(col, row)[3]).toBe(255));
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
      props.filter((p) => p.kind === 'tree' && p.col === levelCol(level) && p.row === band('trees')).length;
    expect(treesIn(0)).toBe(0);
    expect(treesIn(1)).toBe(1);
    expect(treesIn(2)).toBe(3);
    expect(treesIn(4)).toBeGreaterThan(treesIn(2));
  });

  it('never stands a tree or bush in water', () => {
    for (const p of props.filter((q) => q.kind === 'tree' || q.kind === 'bush')) {
      expect(coverAt(grid, p.col, p.row)!.water).toBeLessThan(2);
    }
  });

  it('draws rows back to front, props sorted within each row', () => {
    scene.rows.forEach((r, i) => {
      expect(r.tiles.every((t) => t.row === i)).toBe(true);
      for (let k = 1; k < r.props.length; k++) expect(r.props[k].y).toBeGreaterThanOrEqual(r.props[k - 1].y);
    });
  });

  it('gives every hex a top and two front faces', () => {
    const tiles = scene.rows.flatMap((r) => r.tiles);
    expect(tiles).toHaveLength(grid.cells.length);
    expect(tiles.every((t) => t.top.length === 6 && t.faces.length === 2)).toBe(true);
  });
});

describe('buildScene (highlands)', () => {
  const hl = build('highlands');
  const tiles = hl.scene.rows.flatMap((r) => r.tiles);

  it('lifts every tile by its elevation in terrace steps', () => {
    for (const t of tiles) expect(t.lift).toBe(elevationAt(hl.grid, t.col, t.row) * view.step);
    expect(Math.max(...tiles.map((t) => t.lift))).toBeGreaterThanOrEqual(7 * view.step);
  });

  it('builds rock walls under high tiles and earth walls under low land', () => {
    const high = tiles.find((t) => t.elevation >= 6)!;
    expect(high.faces.every((f) => f.wall === 'rock')).toBe(true);
    const low = tiles.find((t) => t.elevation === 1)!;
    expect(low.faces.every((f) => f.wall === 'earth')).toBe(true);
  });

  it('crowns the highest ground with peaks, standing on their lifted tile', () => {
    const peaks = hl.scene.rows.flatMap((r) => r.props).filter((p) => p.kind === 'peak');
    expect(peaks.length).toBeGreaterThan(0);
    for (const p of peaks) {
      const tile = tiles.find((t) => t.col === p.col && t.row === p.row)!;
      const top = Math.min(...tile.top.map((q) => q.y));
      const bottom = Math.max(...tile.top.map((q) => q.y));
      expect(p.y).toBeGreaterThanOrEqual(top);
      expect(p.y).toBeLessThanOrEqual(bottom);
    }
  });
});
