import type { Pixel } from '../math/hex';
import { shade, type RGB } from '../rendering/palette';
import { forEachCell, inGrid, type CoverGrid } from './coverGrid';
import { offsetNeighbours, pixelToOffset } from '../math/hex';
import { frameCentre, gridFrame, isoSideFaces, isoTop, toIso, type GridFrame, type IsoView } from './geometry';
import { composeTerrain, type Cascade } from './groundComposer';
import type { Cover } from './levels';
import type { GroundTextures } from './placeholderTextures';
import { PROP_RULES, type PropRule } from './propRules';
import { ridgeProps } from './ridges';
import { getPixel, type Raster } from './raster';
import { sliceTerrain, type ReliefOptions, type Slice } from './relief';
import { scatterProps, type PropInstance } from './scatter';
import { createTerrainSampler } from './terrainSampler';

export interface SceneOptions {
  hexSize: number;
  seed: number;
  /** Width of the blend between neighbouring hexes, in hex radii. */
  blend: number;
  view: IsoView;
  relief: ReliefOptions;
  /** Texture for steep mountain faces (seen from the front); flat colour if absent. */
  cliff?: Raster;
  /** Painted cliff under raised water, stretched from the rim to the floor. */
  poolFace?: Raster;
  rules?: readonly PropRule[];
}

/** Which wall texture a face shows; 'none' keeps the plain ground colour (open water). */
export type WallKind = 'none' | 'earth' | 'rock';

/** From this many terrace steps up, walls are bare rock instead of earth. */
export const ROCK_WALL_FROM = 4;

export interface SideFace {
  side: 'left' | 'right';
  points: Pixel[];
  /** Colour of the ground at the top edge: the lip, and the fallback fill. */
  color: RGB;
  wall: WallKind;
}

export interface TileDraw {
  col: number;
  row: number;
  elevation: number;
  /** Ground height at the hex centre, in pixels. */
  lift: number;
  /** Outline at the centre's height, in iso pixels. */
  top: Pixel[];
  /** Slab faces under the floor, only where no hex in front covers them (the map's front edge). */
  faces: SideFace[];
}

/** Ground pixel rows per drawing band: props are ordered against the terrain at this depth resolution. */
export const BAND_ROWS = 6;

/** A thin horizontal strip of the map, drawn back to front. */
export interface SceneBand {
  /** The strip's terrain, already projected with relief. */
  slice: Slice;
  /** Props whose foot lies in this strip, iso pixels (bottom-centre anchor), back to front. */
  props: PropInstance[];
}

/**
 * Everything needed to draw a map: the slab faces under the map, then bands
 * back to front, each its terrain followed by the props standing in it, so
 * nearer slopes hide what lies behind them and trees stand on their hill.
 * Pure data, testable without a canvas.
 */
export interface Scene {
  frame: GridFrame;
  view: IsoView;
  hexSize: number;
  /** The whole map's ground, top-down, before projection. */
  ground: Raster;
  /** Height above the floor per ground pixel, in screen pixels. */
  heights: Float32Array;
  /** Per hex, row-major. */
  tiles: TileDraw[];
  bands: SceneBand[];
}

export const tileAt = (scene: Scene, col: number, row: number): TileDraw | undefined =>
  scene.tiles.find((t) => t.col === col && t.row === row);

function wallKind(cover: Cover, elevation: number): WallKind {
  if (elevation === 0 && cover.water >= 2) return 'none';
  return elevation >= ROCK_WALL_FROM ? 'rock' : 'earth';
}

/** Ground colour just inside a lower edge, lit from the left. */
function lipColour(ground: Raster, centre: Pixel, size: number, dx: number, k: number): RGB {
  const x = Math.min(ground.width - 1, Math.max(0, Math.round(centre.x + dx * size)));
  const y = Math.min(ground.height - 1, Math.round(centre.y + 0.66 * size));
  const [r, g, b] = getPixel(ground, x, y);
  return shade([r, g, b], k);
}

/** Height at a frame pixel, clamped to the frame. */
function heightAt(heights: Float32Array, frame: GridFrame, x: number, y: number): number {
  const px = Math.min(frame.width - 1, Math.max(0, Math.round(x)));
  const py = Math.min(frame.height - 1, Math.max(0, Math.round(y)));
  return heights[py * frame.width + px];
}

/** Whether the neighbour in front of a lower edge (SW = 4, SE = 5 in offsetNeighbours order) is missing. */
function exposed(grid: CoverGrid, col: number, row: number, dir: 4 | 5): boolean {
  const d = offsetNeighbours(row)[dir];
  return !inGrid(grid, col + d.dc, row + d.dr);
}

function tileDraw(grid: CoverGrid, ground: Raster, heights: Float32Array, cover: Cover, col: number, row: number, elevation: number, opts: SceneOptions, frame: GridFrame): TileDraw {
  const { hexSize: size, view } = opts;
  const centre = frameCentre(col, row, size, frame);
  const lift = heightAt(heights, frame, centre.x, centre.y);
  const wall = wallKind(cover, Math.round(elevation));
  const [left, right] = isoSideFaces(centre, size, view);
  return {
    col,
    row,
    elevation,
    lift,
    top: isoTop(centre, size, view, lift),
    faces: [
      ...(exposed(grid, col, row, 4) ? [{ side: 'left' as const, points: left, color: lipColour(ground, centre, size, -0.4, 0.78), wall }] : []),
      ...(exposed(grid, col, row, 5) ? [{ side: 'right' as const, points: right, color: lipColour(ground, centre, size, 0.4, 0.6), wall }] : []),
    ],
  };
}

const bandIndex = (bands: SceneBand[], fy: number) => Math.min(bands.length - 1, Math.max(0, Math.floor(Math.floor(fy) / BAND_ROWS)));

/** Radius around a waterfall kept free of other props, in hex radii. */
const FALL_CLEARANCE = 1;

/** A waterfall sprite standing on its cascade's foot, drawn at the cascade's height. */
function cascadeProp(c: Cascade, variant: number, frame: GridFrame, view: IsoView, size: number): PropInstance {
  const iso = toIso(c.at, view);
  const hex = pixelToOffset(c.at.x - frame.ox, c.at.y - frame.oy, size);
  return { kind: 'fall', variant, x: iso.x, y: iso.y, col: hex.col, row: hex.row, height: c.height };
}

export function buildScene(grid: CoverGrid, textures: GroundTextures, opts: SceneOptions): Scene {
  const { hexSize: size, seed, view } = opts;
  const frame = gridFrame(grid.cols, grid.rows, size);
  const terrain = createTerrainSampler(grid, size, opts.blend, seed);
  const t = composeTerrain(terrain, grid, textures, frame, size, seed, opts.relief);
  const { ground, heights } = t;
  const bandOf = t.rows.map((r, i) => (r < 0 ? -1 : Math.floor(Math.floor(i / frame.width) / BAND_ROWS)));
  const faces = { wall: opts.cliff, pool: opts.poolFace, pools: t.pool, falls: t.falls };
  const bands: SceneBand[] = sliceTerrain(ground, heights, bandOf, view.squash, faces).map((slice) => ({ slice, props: [] }));

  const tiles: TileDraw[] = [];
  forEachCell(grid, (cover, col, row, elevation) => tiles.push(tileDraw(grid, ground, heights, cover, col, row, elevation, opts, frame)));

  // On the flat map mountains are ridge sprites; rivers keep their cells free of them.
  const riverCells = new Set(t.rivers.flatMap((r) => r.cells));
  const ridges = opts.relief.style === 'sprites' ? ridgeProps(grid, size, seed, riverCells) : [];
  const free = (x: number, y: number) =>
    !t.river[Math.floor(y) * frame.width + Math.floor(x)] && t.cascades.every((c) => Math.hypot(x - c.at.x, y - c.at.y) > FALL_CLEARANCE * size);
  for (const p of [...scatterProps(grid, terrain, opts.rules ?? PROP_RULES, size, seed), ...ridges]) {
    const fx = p.x + frame.ox;
    const fy = p.y + frame.oy;
    if (!free(fx, fy)) continue;
    const iso = toIso({ x: fx, y: fy }, view);
    bands[bandIndex(bands, fy)].props.push({ ...p, x: iso.x, y: iso.y - heightAt(heights, frame, fx, fy) });
  }
  t.cascades.forEach((c, i) => bands[bandIndex(bands, c.at.y)].props.push(cascadeProp(c, i, frame, view, size)));
  for (const b of bands) b.props.sort((a, c) => a.y - c.y);

  return { frame, view, hexSize: size, ground, heights, tiles, bands };
}
