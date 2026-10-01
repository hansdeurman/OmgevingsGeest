import { describe, expect, it } from 'vitest';
import { coverAt, elevationAt, forEachCell } from '../coverGrid';
import { LEVEL_BANDS, demoMap } from '../demoMaps';
import { frameCentre } from '../geometry';
import { createPlaceholderTextures } from '../placeholderTextures';
import { getPixel } from '../raster';
import { buildScene } from '../scene';
import { lakeHeight } from '../relief';

/**
 * End-to-end: demo map → terrain sampler → ground image + scattered props +
 * lifted tiles with walls. Checks the composed result the way a viewer would read it.
 */
const SIZE = 16;
const view = { squash: 0.7, thickness: 4 };
const relief = { mountain: 60, hill: 2 };
const textures = createPlaceholderTextures(32);
const build = (id: string) => {
  const { grid } = demoMap(id, 1);
  return { grid, scene: buildScene(grid, textures, { hexSize: SIZE, seed: 3, blend: 0.6, view, relief }) };
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
  const { frame, heights } = hl.scene;
  const heightAt = (x: number, y: number) => heights[Math.round(y) * frame.width + Math.round(x)];

  it('keeps the floor nearly flat away from the mountains', () => {
    for (const t of tiles.filter((t) => t.elevation <= 3)) expect(t.lift).toBeLessThanOrEqual(3.5 * relief.hill + 1);
  });

  it('joins neighbouring mountain hexes into one wall, with no gap between them', () => {
    let pairs = 0;
    forEachCell(hl.grid, (_, col, row, e) => {
      if (e < 6 || col + 1 >= hl.grid.cols || elevationAt(hl.grid, col + 1, row) < 6) return;
      const a = frameCentre(col, row, SIZE, frame);
      const b = frameCentre(col + 1, row, SIZE, frame);
      expect(heightAt((a.x + b.x) / 2, (a.y + b.y) / 2)).toBeGreaterThan(0.4 * relief.mountain);
      pairs++;
    });
    expect(pairs).toBeGreaterThan(0);
  });

  it('lays the high lake flat at its own level, above the floor', () => {
    const lake = tiles.filter((t) => coverAt(hl.grid, t.col, t.row)!.water >= 3 && t.elevation >= 3);
    expect(lake.length).toBeGreaterThan(0);
    for (const t of lake) expect(t.lift).toBeCloseTo(lakeHeight(t.elevation, relief), 4);
  });

  it('stands props on the terrain surface', () => {
    for (const r of hl.scene.rows) {
      for (const p of r.props) {
        const c = frameCentre(p.col, p.row, SIZE, frame);
        expect(Math.abs(p.x - c.x)).toBeLessThan(SIZE);
        expect(p.y).toBeLessThanOrEqual(c.y * view.squash + SIZE);
      }
    }
  });

  it('gives every row a terrain slice', () => {
    hl.scene.rows.forEach((r, i) => expect(r.slice.row).toBe(i));
  });
});
