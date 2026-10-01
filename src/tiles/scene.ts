import type { Pixel } from '../math/hex';
import { mix, shade, type RGB } from '../rendering/palette';
import { forEachCell, inGrid, type CoverGrid } from './coverGrid';
import { offsetNeighbours, pixelToOffset } from '../math/hex';
import { frameCentre, gridFrame, isoSideFaces, isoTop, toIso, type GridFrame, type IsoView } from './geometry';
import { composeTerrain, type Cascade } from './groundComposer';
import type { Cover } from './levels';
import type { GroundTextures } from './placeholderTextures';
import { PROP_RULES, type PropRule } from './propRules';
import { ridgeProps } from './ridges';
import { HIGH_LAKE_FROM, lakeLift, lakeShapes, shoreProps, type LakeShape } from './shores';
import { blurHeights } from './relief';
import type { River } from './rivers';
import { clamp } from '../math/scalar';
import { MAX_ELEVATION } from './levels';
import { valueNoise2D } from '../math/noise';
import { smoothstep } from '../math/scalar';
import { createRaster, getPixel, setPixel, type Raster } from './raster';
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

/** Side of the smallest patch of high water drawn as a lake, in hex radii: smaller specks are shore wetness. */
const MIN_LAKE = 0.6;
/** Radius around a waterfall kept free of other props, in hex radii. */
const FALL_CLEARANCE = 1;

/** A waterfall sprite standing on its cascade's foot, drawn at the cascade's height. */
function cascadeProp(c: Cascade, variant: number, frame: GridFrame, view: IsoView, size: number): PropInstance {
  const iso = toIso(c.at, view);
  const hex = pixelToOffset(c.at.x - frame.ox, c.at.y - frame.oy, size);
  return { kind: 'fall', variant, x: iso.x, y: iso.y, col: hex.col, row: hex.row, height: c.height };
}

/**
 * A mountain lake's water, as painted in its sprites: lighter in the shallows,
 * deep blue in the middle; a lake on the foothills is a fresher, greener blue.
 */
const LAKE_SHALLOW: RGB = [66, 118, 148];
const LAKE_DEEP: RGB = [36, 82, 114];
const HILL_SHALLOW: RGB = [84, 150, 160];
const HILL_DEEP: RGB = [46, 112, 138];

/**
 * Colour a high lake's water and place it in scene pixels: squashed by the
 * view and lifted by the lake's height. Deeper away from the shore, with soft
 * ripples of light; colder and darker the higher the lake.
 */
function paintSurface(shape: LakeShape, size: number, view: IsoView) {
  const { width: W, height: H } = shape;
  const soft = Float32Array.from(shape.mask);
  const deep = Float32Array.from(shape.mask);
  blurHeights(soft, W, H, 1);
  blurHeights(deep, W, H, Math.max(1, Math.round(size * 0.3)));
  const cold = smoothstep(HIGH_LAKE_FROM, MAX_ELEVATION - 1, shape.level);
  const [shallow, deepest] = [mix(HILL_SHALLOW, LAKE_SHALLOW, cold), mix(HILL_DEEP, LAKE_DEEP, cold)];
  const raster = createRaster(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!shape.mask[i]) continue;
      const ripple = valueNoise2D((shape.x0 + x) * 0.08, (shape.y0 + y) * 0.22, 41) - 0.5;
      const c = shade(mix(shallow, deepest, smoothstep(0.5, 0.95, deep[i])), 1 + 0.16 * ripple);
      setPixel(raster, x, y, c, Math.round(clamp(soft[i] * 2 - 0.2, 0, 1) * 255));
    }
  }
  const top = toIso({ x: shape.x0, y: shape.y0 }, view);
  return { raster, x: top.x, y: top.y - lakeLift(shape.level) * size, height: H * view.squash };
}

/** Where a high lake pours out (frame pixels): between the lake cell its river starts from and the cell it falls into. */
function outletOf(shape: LakeShape, rivers: readonly River[], grid: CoverGrid, size: number, frame: GridFrame) {
  const centre = (i: number) => frameCentre(i % grid.cols, Math.floor(i / grid.cols), size, frame);
  const inside = (p: { x: number; y: number }) =>
    p.x >= shape.x0 && p.y >= shape.y0 && p.x < shape.x0 + shape.width && p.y < shape.y0 + shape.height;
  const river = rivers.find((r) => Math.abs(grid.elevation[r.cells[0]] - shape.level) < 1e-6 && inside(centre(r.cells[0])));
  if (!river) return undefined;
  const [a, b] = [centre(river.cells[0]), centre(river.outlet[1])];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
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
  const flat = opts.relief.style === 'sprites';
  const riverCells = new Set(t.rivers.flatMap((r) => r.cells));
  const ridges = flat ? ridgeProps(grid, size, seed, riverCells) : [];
  const toScene = (p: PropInstance) => {
    const [fx, fy] = [p.x + frame.ox, p.y + frame.oy];
    const iso = toIso({ x: fx, y: fy }, view);
    return { fy, prop: { ...p, x: iso.x, y: iso.y - heightAt(heights, frame, fx, fy) } };
  };
  const free = (x: number, y: number) =>
    !t.river[Math.floor(y) * frame.width + Math.floor(x)] && t.cascades.every((c) => Math.hypot(x - c.at.x, y - c.at.y) > FALL_CLEARANCE * size);
  for (const p of [...scatterProps(grid, terrain, opts.rules ?? PROP_RULES, size, seed), ...ridges]) {
    if (!free(p.x + frame.ox, p.y + frame.oy)) continue;
    const { fy, prop } = toScene(p);
    bands[bandIndex(bands, fy)].props.push(prop);
  }
  // Each high lake is one prop where its nearest bank stands: far-shore rocks, then the lifted water, then the banks.
  for (const shape of flat ? lakeShapes(t.highWater, frame.width, frame.height, (MIN_LAKE * size) ** 2) : []) {
    const { back, front, lift } = shoreProps(shape, size, seed, outletOf(shape, t.rivers, grid, size, frame));
    const iso = (p: PropInstance, raise = 0) => ({ ...p, x: p.x, y: p.y * view.squash - raise });
    const footY = Math.max(shape.y0 + shape.height, ...front.map((p) => p.y));
    const lake: PropInstance = { kind: 'backRock', variant: 0, x: shape.x0, y: footY * view.squash, col: -1, row: -1 };
    bands[bandIndex(bands, footY)].props.push({ ...lake, parts: back.map((p) => iso(p, lift)), surface: paintSurface(shape, size, view), front: front.map((p) => iso(p)) });
  }
  t.cascades.forEach((c, i) => bands[bandIndex(bands, c.at.y)].props.push(cascadeProp(c, i, frame, view, size)));
  for (const b of bands) b.props.sort((a, c) => a.y - c.y);

  return { frame, view, hexSize: size, ground, heights, tiles, bands };
}
