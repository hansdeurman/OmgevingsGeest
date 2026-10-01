import type { Pixel } from '../math/hex';
import { shade, type RGB } from '../rendering/palette';
import { forEachCell, type CoverGrid } from './coverGrid';
import { frameCentre, gridFrame, isoSideFaces, isoTop, toIso, type GridFrame, type IsoView } from './geometry';
import { composeTerrain } from './groundComposer';
import type { Cover } from './levels';
import type { GroundTextures } from './placeholderTextures';
import { PROP_RULES, type PropRule } from './propRules';
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
  /** Ground height at the hex centre, in pixels. */
  lift: number;
  /** Outline at the centre's height, in iso pixels. */
  top: Pixel[];
  /** The slab's front faces under the floor; only the map's front edge shows them. */
  faces: SideFace[];
}

export interface SceneRow {
  tiles: TileDraw[];
  /** This row's terrain, already projected with relief. */
  slice: Slice;
  /** Props standing on this row, iso pixels (bottom-centre anchor), back to front. */
  props: PropInstance[];
}

/**
 * Everything needed to draw a map. Rows go back to front: the renderer draws
 * a row's slab faces, its terrain slice, then its props, so nearer terrain and
 * mountains hide what lies behind them. Pure data, testable without a canvas.
 */
export interface Scene {
  frame: GridFrame;
  view: IsoView;
  hexSize: number;
  /** The whole map's ground, top-down, before projection. */
  ground: Raster;
  /** Height above the floor per ground pixel, in screen pixels. */
  heights: Float32Array;
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

/** Height at a frame pixel, clamped to the frame. */
function heightAt(heights: Float32Array, frame: GridFrame, x: number, y: number): number {
  const px = Math.min(frame.width - 1, Math.max(0, Math.round(x)));
  const py = Math.min(frame.height - 1, Math.max(0, Math.round(y)));
  return heights[py * frame.width + px];
}

function tileDraw(ground: Raster, heights: Float32Array, cover: Cover, col: number, row: number, elevation: number, opts: SceneOptions, frame: GridFrame): TileDraw {
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
      { points: left, color: lipColour(ground, centre, size, -0.4, 0.78), wall },
      { points: right, color: lipColour(ground, centre, size, 0.4, 0.6), wall },
    ],
  };
}

export function buildScene(grid: CoverGrid, textures: GroundTextures, opts: SceneOptions): Scene {
  const { hexSize: size, seed, view } = opts;
  const frame = gridFrame(grid.cols, grid.rows, size);
  const terrain = createTerrainSampler(grid, size, opts.blend, seed);
  const { ground, heights, rows: rowOf } = composeTerrain(terrain, grid, textures, frame, size, seed, opts.relief);
  const slices = sliceTerrain(ground, heights, rowOf, view.squash, opts.cliff);

  const rows: SceneRow[] = slices.map((slice) => ({ tiles: [], slice, props: [] }));
  forEachCell(grid, (cover, col, row, elevation) =>
    rows[row].tiles.push(tileDraw(ground, heights, cover, col, row, elevation, opts, frame)),
  );

  for (const p of scatterProps(grid, terrain, opts.rules ?? PROP_RULES, size, seed)) {
    const fx = p.x + frame.ox;
    const fy = p.y + frame.oy;
    const iso = toIso({ x: fx, y: fy }, view);
    rows[p.row].props.push({ ...p, x: iso.x, y: iso.y - heightAt(heights, frame, fx, fy) });
  }
  for (const r of rows) r.props.sort((a, b) => a.y - b.y);

  return { frame, view, hexSize: size, ground, heights, rows };
}
