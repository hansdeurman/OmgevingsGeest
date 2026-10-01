import { describe, expect, it } from 'vitest';
import { coverAt, elevationAt, forEachCell } from '../coverGrid';
import { LEVEL_BANDS, demoMap } from '../demoMaps';
import { frameCentre } from '../geometry';
import { createPlaceholderTextures } from '../placeholderTextures';
import { getPixel } from '../raster';
import { BAND_ROWS, buildScene } from '../scene';
import { offsetNeighbours } from '../../math/hex';
import { lakeHeight } from '../relief';
import { lakeOutlets } from '../hydrology';

/**
 * End-to-end: demo map → terrain sampler → ground image + scattered props +
 * lifted tiles with walls. Checks the composed result the way a viewer would read it.
 */
const SIZE = 16;
const view = { squash: 0.7, thickness: 4 };
const relief = { height: 30 };
const textures = createPlaceholderTextures(32);
const build = (id: string) => {
  const { grid } = demoMap(id, 1);
  return { grid, scene: buildScene(grid, textures, { hexSize: SIZE, seed: 3, blend: 0.6, view, relief }) };
};
const { grid, scene } = build('levels');
const props = scene.bands.flatMap((b) => b.props);

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

  it('covers the map with thin bands, back to front, props sorted within each band', () => {
    expect(scene.bands).toHaveLength(Math.ceil(scene.frame.height / BAND_ROWS));
    scene.bands.forEach((b, i) => {
      expect(b.slice.index).toBe(i);
      for (let k = 1; k < b.props.length; k++) expect(b.props[k].y).toBeGreaterThanOrEqual(b.props[k - 1].y);
    });
  });

  it('gives every hex an outline, and slab faces only along the front edge', () => {
    expect(scene.tiles).toHaveLength(grid.cells.length);
    expect(scene.tiles.every((t) => t.top.length === 6)).toBe(true);
    const lastRow = grid.rows - 1;
    for (const t of scene.tiles) {
      if (t.row === lastRow) expect(t.faces).toHaveLength(2);
      else if (t.col > 0 && t.col < grid.cols - 1) expect(t.faces).toHaveLength(0);
    }
  });
});

describe('buildScene (highlands)', () => {
  const hl = build('highlands');
  const { frame, heights, tiles } = hl.scene;
  const heightAt = (x: number, y: number) => heights[Math.round(y) * frame.width + Math.round(x)];
  const neighbourElevations = (col: number, row: number) =>
    offsetNeighbours(row).map((d) => elevationAt(hl.grid, col + d.dc, row + d.dr));

  it('keeps the floor nearly flat away from the mountains', () => {
    const low = tiles.filter((t) => t.elevation <= 3 && Math.max(...neighbourElevations(t.col, t.row)) <= 3.5);
    expect(low.length).toBeGreaterThan(10);
    for (const t of low) expect(t.lift).toBeLessThanOrEqual(0.25 * relief.height + 1);
  });

  it('never rises much more than the relief height', () => {
    expect(heights.reduce((m, h) => Math.max(m, h), 0)).toBeLessThanOrEqual(1.2 * relief.height);
  });

  it('joins neighbouring mountain hexes into one wall, with no gap between them', () => {
    let pairs = 0;
    forEachCell(hl.grid, (_, col, row, e) => {
      if (e < 6 || col + 1 >= hl.grid.cols || elevationAt(hl.grid, col + 1, row) < 6) return;
      const a = frameCentre(col, row, SIZE, frame);
      const b = frameCentre(col + 1, row, SIZE, frame);
      expect(heightAt((a.x + b.x) / 2, (a.y + b.y) / 2)).toBeGreaterThan(0.4 * relief.height);
      pairs++;
    });
    expect(pairs).toBeGreaterThan(0);
  });

  it('lays the high lake flat at its own level, high up and just below its rim', () => {
    const lake = tiles.filter((t) => coverAt(hl.grid, t.col, t.row)!.water >= 3 && t.elevation >= 3);
    expect(lake.length).toBeGreaterThan(0);
    for (const t of lake) {
      expect(t.lift).toBeCloseTo(lakeHeight(t.elevation, relief), 4);
      expect(t.lift).toBeGreaterThan(0.4 * relief.height);
    }
    const rimTops = lake.flatMap((t) => neighbourElevations(t.col, t.row)).filter((e) => e > lake[0].elevation);
    expect(Math.max(...rimTops)).toBeGreaterThan(lake[0].elevation + 0.5);
  });

  it('stands every prop on the terrain under its foot, in the band of its foot', () => {
    hl.scene.bands.forEach((b, i) => {
      for (const p of b.props) {
        const fy = (p.y + 0) / view.squash; // iso y of a flat foot maps back to frame y
        expect(Math.floor(fy / BAND_ROWS)).toBeLessThanOrEqual(i + 1);
      }
    });
  });
});

describe('buildScene (highlands, flat map)', () => {
  const { grid: hg } = demoMap('highlands', 1);
  const scene = buildScene(hg, textures, { hexSize: SIZE, seed: 3, blend: 0.6, view, relief: { height: 30, style: 'sprites' } });
  const props = scene.bands.flatMap((b) => b.props);
  const falls = props.filter((p) => p.kind === 'fall');
  const isLake = (i: number) => hg.cells[i].water >= 2 && hg.elevation[i] > 0.5;
  const [outlet] = lakeOutlets(hg, isLake);

  it('keeps every tile on the floor, the high lake included', () => {
    expect(scene.tiles.every((t) => t.lift === 0)).toBe(true);
  });

  it('shows the mountains as ridge sprites, snowy peaks only on the highest ground', () => {
    const peaks = props.filter((p) => p.kind === 'peak');
    expect(peaks.length).toBeGreaterThan(0);
    for (const p of peaks) expect(elevationAt(hg, p.col, p.row)).toBeGreaterThanOrEqual(6.5);
  });

  it('leaves a gap in the ridge where the lake pours out', () => {
    const ridge = props.filter((p) => p.kind === 'peak' || p.kind === 'crag' || p.kind === 'hill');
    const at = (i: number) => (p: { col: number; row: number }) => p.col === i % hg.cols && p.row === Math.floor(i / hg.cols);
    expect(ridge.some(at(outlet.from))).toBe(false);
    expect(ridge.some(at(outlet.to))).toBe(false);
  });

  it('puts a cascade at the lake\'s outlet', () => {
    expect(falls.length).toBeGreaterThan(0);
    const near = [outlet.from, outlet.to].flatMap((i) => {
      const [c, r] = [i % hg.cols, Math.floor(i / hg.cols)];
      return [[c, r], ...offsetNeighbours(r).map((d) => [c + d.dc, r + d.dr])];
    });
    expect(falls.some((f) => near.some(([c, r]) => c === f.col && r === f.row))).toBe(true);
  });

  it('keeps rocks, trees and plants out of the way of the waterfalls', () => {
    const others = props.filter((p) => p.kind !== 'fall');
    for (const f of falls) for (const p of others) expect(Math.hypot(p.x - f.x, (p.y - f.y) / view.squash)).toBeGreaterThan(0.5 * SIZE);
  });
});
