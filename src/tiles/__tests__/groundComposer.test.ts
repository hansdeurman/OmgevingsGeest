import { describe, expect, it } from 'vitest';
import { offsetToPixel, pixelToOffset } from '../../math/hex';
import { coverAt } from '../coverGrid';
import { demoMap, floodedGrid } from '../demoMaps';
import type { CoverGrid } from '../coverGrid';
import { gridFrame } from '../geometry';
import { composeTerrain, joinBases, paintBaseRows } from '../groundComposer';
import { createPlaceholderTextures } from '../placeholderTextures';
import type { ReliefOptions } from '../relief';
import { createTerrainSampler } from '../terrainSampler';

const SIZE = 14;
const { grid, water } = demoMap('highlands', 1);
const frame = gridFrame(grid.cols, grid.rows, SIZE);
const composeOn = (g: CoverGrid, relief: ReliefOptions, highWater?: number[]) =>
  composeTerrain(createTerrainSampler(g, SIZE, 0.6, 3), g, createPlaceholderTextures(32), frame, SIZE, 3, relief, highWater);
/** The flat map shows the high basins dry (their water is drawn apart); the relief style shows them filled. */
const compose = (relief: ReliefOptions) =>
  relief.style === 'sprites' ? composeOn(grid, relief, water) : composeOn(floodedGrid(grid, water), relief);
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

  it('paints a river from the high lake down to the sea', () => {
    expect(t.rivers).toHaveLength(1);
    const cells = t.rivers[0].cells;
    const last = grid.cells[cells[cells.length - 1]];
    expect(last.water).toBeGreaterThanOrEqual(2);
    expect(grid.elevation[cells[cells.length - 1]]).toBeLessThanOrEqual(0.5);
    expect(t.river.some(Boolean)).toBe(true);
  });

  it('paints white water where the river drops, instead of pasting a waterfall sprite on it', () => {
    expect(t.cascades).toHaveLength(0);
    const [a, b] = t.rivers[0].cascades[0];
    const centre = (i: number) => offsetToPixel(i % grid.cols, Math.floor(i / grid.cols), SIZE);
    const drop = { x: (centre(a).x + centre(b).x) / 2 + frame.ox, y: (centre(a).y + centre(b).y) / 2 + frame.oy };
    const river = [...t.river.keys()].filter((i) => t.river[i]);
    const dist = (i: number) => Math.hypot((i % frame.width) - drop.x, Math.floor(i / frame.width) - drop.y);
    const bright = (i: number) => t.ground.data[i * 4] + t.ground.data[i * 4 + 1] + t.ground.data[i * 4 + 2];
    const mean = (xs: number[]) => xs.reduce((s, i) => s + bright(i), 0) / xs.length;
    // Against the same river just beyond the white water, at about the same height (water darkens with altitude).
    const beyond = river.filter((i) => dist(i) > SIZE * 1 && dist(i) < SIZE * 1.5);
    expect(mean(river.filter((i) => dist(i) < SIZE * 0.3))).toBeGreaterThan(mean(beyond) + 50);
  });

  it('draws height lines only when asked', () => {
    const lines = compose({ height: 30, style: 'sprites', contours: true });
    const changed = [...lines.ground.data.keys()].filter((k) => lines.ground.data[k] !== t.ground.data[k]);
    expect(changed.length).toBeGreaterThan(0);
  });
});

describe('paintBaseRows', () => {
  it('paints in bands that, joined, are the whole ground exactly, so bands can be painted side by side', () => {
    const textures = createPlaceholderTextures(32);
    const terrain = createTerrainSampler(grid, SIZE, 0.6, 3);
    const relief = { height: 30, style: 'sprites' as const };
    const paint = (y0: number, y1: number) => paintBaseRows(terrain, grid, textures, frame, SIZE, 3, relief, y0, y1);
    const whole = paint(0, frame.height);
    const cut = [0, 17, 90, frame.height];
    const joined = joinBases(cut.slice(1).map((y1, k) => paint(cut[k], y1)));
    const same = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.prototype.every.call(a, (v: number, i: number) => Object.is(v, b[i]));
    expect(joined.ground.height).toBe(frame.height);
    for (const k of ['field', 'elevation', 'rows', 'lake', 'open'] as const) expect(same(joined[k], whole[k])).toBe(true);
    expect(same(joined.ground.data, whole.ground.data)).toBe(true);
    const t = composeTerrain(terrain, grid, textures, frame, SIZE, 3, relief, water, true, joined);
    expect(same(t.ground.data, composeOn(grid, relief, water).ground.data)).toBe(true);
  }, 60000);
});
