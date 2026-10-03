import { describe, expect, it } from 'vitest';
import { coverAt, elevationAt, forEachCell } from '../coverGrid';
import { LEVEL_BANDS, demoMap, floodedGrid } from '../demoMaps';
import { frameCentre } from '../geometry';
import { createPlaceholderTextures } from '../placeholderTextures';
import { getPixel } from '../raster';
import { BAND_ROWS, buildScene, paintLakes } from '../scene';
import { offsetNeighbours } from '../../math/hex';
import { lakeHeight } from '../relief';
import { lakeOutlets } from '../hydrology';
import { phaseEnd, runScript, seasonScript } from '../../water/waterScript';
import { hydroWorldOf } from '../mapHydro';
import type { PropInstance } from '../scatter';

/**
 * End-to-end: demo map → terrain sampler → ground image + scattered props +
 * lifted tiles with walls. Checks the composed result the way a viewer would read it.
 */
const SIZE = 16;
const view = { squash: 0.7, thickness: 4 };
const relief = { height: 30 };
const textures = createPlaceholderTextures(32);
/** A map in the relief style, its high basins filled. */
const build = (id: string) => {
  const map = demoMap(id, 1);
  const grid = floodedGrid(map.grid, map.water);
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

const flatOptions = { hexSize: SIZE, seed: 3, blend: 0.6, view, relief: { height: 30, style: 'sprites' as const } };

describe('buildScene (highlands, flat map)', () => {
  const { grid: hg, water } = demoMap('highlands', 1);
  const scene = buildScene(hg, textures, { ...flatOptions, highWater: water });
  const props = scene.bands.flatMap((b) => b.props);
  const falls = props.filter((p) => p.kind === 'fall');
  const full = floodedGrid(hg, water);
  const isLake = (i: number) => full.cells[i].water >= 2 && full.elevation[i] > 0.5;
  const [outlet] = lakeOutlets(full, isLake);

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

  const [lake] = props.filter((p) => p.surface);
  const lakeRaster = lake.surface!.raster;
  /** Rows of the lake image that are drawn at frame column x. */
  const paintedRows = (x: number) =>
    Array.from({ length: lakeRaster.height }, (_, y) => y).filter((y) => getPixel(lakeRaster, Math.round(x - lake.surface!.x), y)[3] > 200);

  it('draws the high lake as one painted object', () => {
    expect(props.filter((p) => p.surface)).toHaveLength(1);
    expect(lake.surface!.height).toBe(lakeRaster.height); // painted in scene pixels, not squashed again
  });

  it('lifts the water above the land and walls it in down to the floor', () => {
    const lakeCells = [...hg.cells.keys()].filter(isLake).map((i) => frameCentre(i % hg.cols, Math.floor(i / hg.cols), SIZE, scene.frame));
    const c = lakeCells.reduce((a, b) => (b.y > a.y ? b : a)); // the nearest lake cell
    const rows = paintedRows(c.x);
    expect(rows.length).toBeGreaterThan(0);
    // The painted column reaches the floor in front of the lake, and rises above the land it covers.
    expect(lake.surface!.y + Math.max(...rows)).toBeGreaterThan(c.y * view.squash);
    expect(lake.surface!.y + Math.min(...rows)).toBeLessThan(c.y * view.squash - SIZE * 0.25);
  });

  it('repaints the water without rebuilding the land, leaving the scene it came from as it was', () => {
    const dry = paintLakes(scene, textures, { hexSize: SIZE, view }, { depth: new Array(hg.cols * hg.rows).fill(0) });
    expect(dry.tiles).toBe(scene.tiles);
    expect(dry.ground).toBe(scene.ground);
    expect(dry.bands.flatMap((b) => b.props).filter((p) => p.surface)).toHaveLength(0);
    expect(scene.bands.flatMap((b) => b.props).filter((p) => p.surface)[0]).toBe(lake);
  });

  it('paints no open water on the ground under the mountain lake: the water is in the sprites', () => {
    const blue = [...hg.cells.keys()]
      .filter((i) => isLake(i))
      .map((i) => frameCentre(i % hg.cols, Math.floor(i / hg.cols), SIZE, scene.frame))
      .filter((c) => {
        const [r, , b] = getPixel(scene.ground, Math.round(c.x), Math.round(c.y));
        return b - r > 40;
      });
    expect(blue.length).toBeLessThanOrEqual(1); // at most where the river leaves
  });

  it('pastes no waterfall sprites onto the flat map: rivers carry their own white water', () => {
    expect(falls).toHaveLength(0);
  });
});

describe('buildScene (mountains, flat map, water from a simulation)', () => {
  const { grid: mg, water } = demoMap('mountains', 3);
  const scene = buildScene(mg, textures, { ...flatOptions, highWater: water });
  const cells = mg.cols * mg.rows;
  const world = hydroWorldOf(mg);
  const script = seasonScript(mg.cols, mg.rows, mg.elevation, water!);
  const states = runScript(world, script);
  const paint = (depth: ArrayLike<number>, flux?: Float32Array) => paintLakes(scene, textures, { hexSize: SIZE, view }, { depth, flux, topo: world.topo });
  const lakesOf = (s: typeof scene) => s.bands.flatMap((b) => b.props).filter((p) => p.surface);
  const landOf = (s: typeof scene) => s.bands.flatMap((b) => b.props).filter((p) => !p.surface);
  const highest = scene.basins.reduce((a, b) => (b.full > a.full ? b : a));
  const inHighest = (p: PropInstance) => highest.cells.includes(p.row * mg.cols + p.col);
  const mountainsIn = (s: typeof scene) => landOf(s).filter((p) => p.elevation !== undefined && inHighest(p));

  it('shows an empty basin as plain land: mountains where its ground is high, no lake', () => {
    const dry = paint(new Array(cells).fill(0));
    expect(lakesOf(dry)).toHaveLength(0);
    expect(mountainsIn(dry).length).toBeGreaterThan(0);
  });

  it('covers the basin\'s mountains when it is full', () => {
    expect(lakesOf(scene).length).toBeGreaterThanOrEqual(scene.basins.length);
    expect(mountainsIn(scene).length).toBeLessThan(mountainsIn(paint(new Array(cells).fill(0))).length);
  });

  it('shrinks a falling lake into its deepest spots, at a lower level', () => {
    const lower = water!.map((d) => Math.max(0, d - 0.8));
    const area = (s: typeof scene) => lakesOf(s).reduce((n, p) => n + p.surface!.raster.width * p.surface!.raster.height, 0);
    expect(area(paint(lower))).toBeLessThan(area(scene));
  });

  it('reuses a lake\'s painting while its water barely changes, and paints it anew once it does', () => {
    const rasters = (s: typeof scene) => lakesOf(s).map((p) => p.surface!.raster);
    const before = rasters(paint(water!));
    const nudged = rasters(paint(water!.map((d) => (d > 0 ? d + 0.005 : d))));
    expect(nudged.length).toBe(before.length);
    expect(nudged.every((r, k) => r === before[k])).toBe(true); // the very same paintings
    const lower = rasters(paint(water!.map((d) => Math.max(0, d - 0.3))));
    expect(lower.some((r) => before.includes(r))).toBe(false);
  });

  it('stands every prop it keeps on dry land, and lifts the ones on a lake to its height', () => {
    for (const k of [40, 120, 200, 230, 300, 440]) {
      const s = paint(states[k].depth);
      for (const lake of lakesOf(s)) for (const r of lake.riders ?? []) expect(r.y).toBeLessThan(lake.y);
      const riders = lakesOf(s).flatMap((l) => l.riders ?? []);
      const land = landOf(s);
      expect(land.length + riders.length).toBeLessThanOrEqual(landOf(paint(new Array(cells).fill(0))).length);
    }
  });
});

describe('buildScene (mountains, flat map, ground and rivers living with the water)', () => {
  const { grid: mg, water } = demoMap('mountains', 3);
  const world = hydroWorldOf(mg);
  const script = seasonScript(mg.cols, mg.rows, mg.elevation, water!);
  const states = runScript(world, script);
  const stateAt = (k: number) => ({ ...states[k], topo: world.topo });
  const scene = buildScene(mg, textures, { ...flatOptions, highWater: water, water: stateAt(phaseEnd(script, 'Spring rain')) });
  const at = (k: number) => paintLakes(scene, textures, { hexSize: SIZE, view }, stateAt(k));
  const [spring, summer] = [at(phaseEnd(script, 'Spring rain')), at(phaseEnd(script, 'Dry summer'))];
  /** Mean colour of the projected ground over the land hexes of normal cover. */
  const meanOver = (s: typeof scene, pick: (i: number) => boolean) => {
    const sum = [0, 0, 0];
    let k = 0;
    for (let i = 0; i < mg.cols * mg.rows; i++) {
      if (!pick(i)) continue;
      const c = frameCentre(i % mg.cols, Math.floor(i / mg.cols), SIZE, s.frame);
      const p = getPixel(s.flat!, Math.round(c.x), Math.round(c.y * view.squash));
      [0, 1, 2].forEach((n) => (sum[n] += p[n]));
      k++;
    }
    return sum.map((v) => v / k);
  };
  const grassy = (i: number) => mg.cells[i].grass >= 3 && mg.cells[i].water === 0 && mg.elevation[i] < 4;

  it('draws the ground as one projected image, repainted with the water', () => {
    expect(spring.flat!.width).toBe(scene.frame.width);
    expect(spring.flat!.height).toBe(Math.ceil(scene.frame.height * view.squash));
    expect(summer.flat).not.toBe(spring.flat);
    expect(summer.ground).toBe(spring.ground); // the land itself is shared
  });

  it('lets the grass go yellow in a dry summer and darken in spring rain', () => {
    const [wet, dry] = [meanOver(spring, grassy), meanOver(summer, grassy)];
    const lum = ([r, g, b]: number[]) => 0.3 * r + 0.59 * g + 0.11 * b;
    expect(dry[0] / dry[1]).toBeGreaterThan(wet[0] / wet[1] + 0.05); // yellower: more straw, less green
    expect(lum(dry)).toBeGreaterThan(lum(wet) + 10); // paler, where spring rain darkened it
  });

  it('runs rivers with water in spring and leaves their beds when they run dry', () => {
    const springs = states[phaseEnd(script, 'Spring rain')].river;
    const summers = states[phaseEnd(script, 'Dry summer')].river;
    const flowing = (r: typeof springs) => Array.from(r.flow).filter((f) => f > 0.02).length;
    expect(flowing(springs)).toBeGreaterThan(3 * flowing(summers));
    expect(summer.river!.some((v) => v)).toBe(true);
  });

  it('keeps props out of the rivers', () => {
    for (const s of [spring, summer]) {
      const land = s.bands.flatMap((b) => b.props).filter((p) => !p.surface);
      const onRiver = land.filter((p) => s.river![Math.floor(p.y) * s.frame.width + Math.floor(p.x)]);
      expect(s.river!.some((v) => v)).toBe(true);
      expect(onRiver).toEqual([]);
    }
  });
});

