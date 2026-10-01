import type { Pixel } from '../math/hex';
import { shade, type RGB } from '../rendering/palette';
import { forEachCell, type CoverGrid } from './coverGrid';
import { frameCentre, gridFrame, isoSideFaces, isoTop, toIso, type GridFrame, type IsoView } from './geometry';
import { composeGround } from './groundComposer';
import type { Cover } from './levels';
import type { GroundTextures } from './placeholderTextures';
import { PROP_RULES, type PropRule } from './propRules';
import { getPixel, type Raster } from './raster';
import { scatterProps, type PropInstance } from './scatter';
import { createTerrainSampler } from './terrainSampler';

export interface SceneOptions {
  hexSize: number;
  seed: number;
  /** Width of the blend between neighbouring hexes, in hex radii. */
  blend: number;
  view: IsoView;
  rules?: readonly PropRule[];
}

/** Which wall texture a face shows; 'none' keeps the plain ground colour (open water). */
export type WallKind = 'none' | 'earth' | 'rock';

/** From this many terrace steps up, walls are bare rock instead of earth. */
export const ROCK_WALL_FROM = 4;

export interface SideFace {
  points: Pixel[];
  /** Colour of the ground at the top edge: the lip, and the fallback fill. */
  color: RGB;
  wall: WallKind;
}

export interface TileDraw {
  col: number;
  row: number;
  elevation: number;
  /** Pixels the top face is raised by. */
  lift: number;
  /** Top face in iso pixels, already lifted. */
  top: Pixel[];
  faces: SideFace[];
}

export interface SceneRow {
  tiles: TileDraw[];
  /** Props standing on this row, iso pixels (bottom-centre anchor), back to front. */
  props: PropInstance[];
}

/**
 * Everything needed to draw a map. Rows go back to front; within a row the
 * renderer draws tile columns (walls, then the lifted ground) and then the
 * row's props, so higher land in front correctly hides what lies behind it.
 * Pure data, so it can be built and tested without a canvas.
 */
export interface Scene {
  frame: GridFrame;
  view: IsoView;
  hexSize: number;
  /** The whole map's ground, top-down; each tile shows its own patch of it. */
  ground: Raster;
  rows: SceneRow[];
}

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

function tileDraw(ground: Raster, cover: Cover, col: number, row: number, elevation: number, opts: SceneOptions, frame: GridFrame): TileDraw {
  const { hexSize: size, view } = opts;
  const centre = frameCentre(col, row, size, frame);
  const lift = elevation * view.step;
  const wall = wallKind(cover, elevation);
  const [left, right] = isoSideFaces(centre, size, view, lift);
  return {
    col,
    row,
    elevation,
    lift,
    top: isoTop(centre, size, view, lift),
    faces: [
      { points: left, color: lipColour(ground, centre, size, -0.4, 0.78), wall },
      { points: right, color: lipColour(ground, centre, size, 0.4, 0.6), wall },
    ],
  };
}

export function buildScene(grid: CoverGrid, textures: GroundTextures, opts: SceneOptions): Scene {
  const { hexSize: size, seed, view } = opts;
  const frame = gridFrame(grid.cols, grid.rows, size);
  const terrain = createTerrainSampler(grid, size, opts.blend, seed);
  const ground = composeGround(terrain, textures, frame, size, seed);

  const rows: SceneRow[] = Array.from({ length: grid.rows }, () => ({ tiles: [], props: [] }));
  forEachCell(grid, (cover, col, row, elevation) => rows[row].tiles.push(tileDraw(ground, cover, col, row, elevation, opts, frame)));

  for (const p of scatterProps(grid, terrain, opts.rules ?? PROP_RULES, size, seed)) {
    const iso = toIso({ x: p.x + frame.ox, y: p.y + frame.oy }, view);
    rows[p.row].props.push({ ...p, x: iso.x, y: iso.y - rows[p.row].tiles[p.col].lift });
  }
  for (const r of rows) r.props.sort((a, b) => a.y - b.y);

  return { frame, view, hexSize: size, ground, rows };
}
