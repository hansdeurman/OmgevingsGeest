import type { Pixel } from '../math/hex';
import { shade, type RGB } from '../rendering/palette';
import { forEachCell, inGrid, type CoverGrid } from './coverGrid';
import { offsetNeighbours, pixelToOffset } from '../math/hex';
import { frameCentre, gridFrame, isoSideFaces, isoTop, toIso, type GridFrame, type IsoView } from './geometry';
import { composeTerrain, texelAt, type Cascade } from './groundComposer';
import { paintGroundWater, wetLayer, type WetLayer } from './groundWater';
import type { Cover } from './levels';
import type { GroundTextures } from './placeholderTextures';
import { PROP_RULES, type PropRule } from './propRules';
import { ridgeProps } from './ridges';
import { DEFAULT_WEATHER, lakeArt, lakeState, placeholderLakeKit, type LakeKit, type Weather } from './highLakes';
import { paintLake, type LakeImage } from './lakePainter';
import { getPixel, type Raster } from './raster';
import { findBasins, fullOutflow, lakeOutflow, lakesIn, settleProps, type Basin } from './waterLayer';
import type { HexTopology } from '../water/hexTopology';
import type { RiverState } from '../water/hydroWorld';
import { WETNESS } from '../water/wetness';
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
  /** Art for high lakes on the flat map; plain stand-ins if absent. */
  lakes?: LakeKit;
  /** How warm and windswept the high lakes are. */
  weather?: Weather;
  /**
   * The water high basins hold when full, per cell (steps), over the dry
   * ground of `grid`: it decides where the basins are, where they overflow
   * and where their rivers run. Flat map only.
   */
  highWater?: readonly number[];
  /** The water now (a water model's state): it fills the basins and runs as rivers. Full basins, no rivers, if absent. */
  water?: SceneWater;
}

/** The water on the map at one moment: per hex, and the flow per pipe (with the pipes it runs through). */
export interface SceneWater {
  depth: ArrayLike<number>;
  flux?: Float32Array;
  topo?: HexTopology;
  /** The ground as the water has worn it, per hex (steps); the map's own if absent. */
  ground?: ArrayLike<number>;
  /** How wet each hex is (WETNESS scale): the ground's look follows it. Flat map only. */
  wetness?: ArrayLike<number>;
  /** The rivers and their beds: painted onto the ground. */
  river?: RiverState;
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
  /** Props whose foot lies in this strip, iso pixels (bottom-centre anchor), back to front, as drawn. */
  props: PropInstance[];
  /** The props standing on the land, before any lake covers them. */
  land: PropInstance[];
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
  /** The map's cells: the ground the water stands on. */
  grid: CoverGrid;
  /** The high basins, kept so their water can be repainted without rebuilding the map. */
  basins: Basin[];
  /** On the flat map with a water model: how its ground is repainted as the water changes… */
  wet?: WetLayer;
  /** …and the ground as it is now, projected: drawn whole, under every band's props, instead of the bands' slices… */
  flat?: Raster;
  /** …and which of its pixels its rivers cover now. */
  river?: Uint8Array;
}

/** What painting the high lakes needs from the scene options. */
export type LakeOptions = Pick<SceneOptions, 'hexSize' | 'view' | 'lakes' | 'weather'>;

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

/** A painted high lake as a prop whose foot is its nearest shore, frame row `footY`. */
const lakeProp = (img: LakeImage, footY: number, squash: number): PropInstance => ({
  kind: 'boulder',
  variant: 0,
  x: img.x,
  y: footY * squash,
  col: -1,
  row: -1,
  surface: { raster: img.raster, x: img.x, y: img.y, height: img.raster.height },
});

export function buildScene(grid: CoverGrid, textures: GroundTextures, opts: SceneOptions): Scene {
  const { hexSize: size, seed, view } = opts;
  const frame = gridFrame(grid.cols, grid.rows, size);
  const terrain = createTerrainSampler(grid, size, opts.blend, seed);
  const flat = opts.relief.style === 'sprites';
  // With a water model the flat map's rivers come and go with the water; otherwise they are painted into the ground.
  const live = flat && !!opts.water?.wetness;
  const t = composeTerrain(terrain, grid, textures, frame, size, seed, opts.relief, opts.highWater, !live);
  const { ground, heights } = t;
  const bandOf = t.rows.map((r, i) => (r < 0 ? -1 : Math.floor(Math.floor(i / frame.width) / BAND_ROWS)));
  const faces = { wall: opts.cliff, pool: opts.poolFace, pools: t.pool, falls: t.falls };
  const bands: SceneBand[] = sliceTerrain(ground, heights, bandOf, view.squash, faces).map((slice) => ({ slice, props: [], land: [] }));

  const tiles: TileDraw[] = [];
  forEachCell(grid, (cover, col, row, elevation) => tiles.push(tileDraw(grid, ground, heights, cover, col, row, elevation, opts, frame)));

  // On the flat map mountains are ridge sprites; rivers keep their cells free of them.
  const riverCells = new Set(t.rivers.flatMap((r) => r.cells));
  const ridges = flat ? ridgeProps(grid, size, seed, live ? new Set() : riverCells) : [];
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
    bands[bandIndex(bands, fy)].land.push(prop);
  }
  t.cascades.forEach((c, i) => bands[bandIndex(bands, c.at.y)].land.push(cascadeProp(c, i, frame, view, size)));
  for (const b of bands) b.land.sort(byDepth);

  const full = opts.highWater ?? [];
  const basins = flat ? findBasins(grid, full, t.rivers, frame, size) : [];
  const wet = live ? wetLayer(grid.cols, grid.rows, frame, size, Uint8Array.from(t.rows, (r, i) => (r < 0 || t.open[i] ? 1 : 0)), seed) : undefined;
  return paintLakes({ frame, view, hexSize: size, ground, heights, tiles, bands, grid, basins, wet }, textures, opts, opts.water ?? { depth: full });
}

const byDepth = (a: PropInstance, b: PropInstance) => a.y - b.y;

/**
 * The scene with its water painted as it stands now: the high basins' water
 * as lakes, each one object drawn where its near shore stands, what the water
 * covers hidden, peaks and islands standing on it; and wherever water runs,
 * rivers on the ground. The land is shared, not rebuilt, so this is quick
 * enough to play a simulation.
 */
export function paintLakes(scene: Scene, textures: GroundTextures, opts: LakeOptions, { depth, flux, topo, ground, wetness, river }: SceneWater): Scene {
  const { hexSize: size, view } = opts;
  const now = scene.wet && wetness ? groundNow(scene, scene.wet, textures, { wetness, river, ground: ground ?? scene.grid.elevation }) : undefined;
  const onRiver = (p: PropInstance) => !!now?.river[Math.floor(p.y) * scene.frame.width + Math.floor(p.x)];
  const kit = opts.lakes ?? placeholderLakeKit(size);
  const water = { cols: scene.grid.cols, rows: scene.grid.rows, ground: ground ?? scene.grid.elevation, depth };
  const lakes = scene.basins.flatMap((b) => lakesIn(b, water, scene.frame, size)).map(({ shape, basin }) => {
    const outflow = flux && topo ? lakeOutflow(shape, topo, flux, scene.frame, size) : fullOutflow(shape, basin);
    const state = lakeState(shape, opts.weather ?? DEFAULT_WEATHER, outflow);
    const art = { ...lakeArt(kit, shape.level, textures), floor: scene.ground };
    return paintLake(shape, state, art, view.squash, size);
  });
  const riders = lakes.map((): PropInstance[] => []);
  const bands = scene.bands.map((b) => {
    const settled = settleProps(now ? b.land.filter((p) => !onRiver(p)) : b.land, lakes.map((l) => l.surface), view.squash);
    settled.riders.forEach((r, k) => riders[k].push(...r));
    return { ...b, props: settled.kept };
  });
  lakes.forEach((img, k) => {
    const footY = img.surface.y0 + img.surface.height;
    const band = bands[bandIndex(bands, footY)];
    band.props = [...band.props, { ...lakeProp(img, footY, view.squash), riders: riders[k].sort(byDepth) }].sort(byDepth);
  });
  return { ...scene, bands, flat: now?.ground, river: now?.river };
}

/** The flat map's ground as the water has it now: graded by wetness, with its rivers; high basins' water is drawn apart, so they at most look moist. */
function groundNow(scene: Scene, wet: WetLayer, textures: GroundTextures, state: Parameters<typeof paintGroundWater>[2]) {
  const basin = new Uint8Array(scene.grid.cols * scene.grid.rows);
  for (const b of scene.basins) for (const i of b.cells) basin[i] = 1;
  const { seed, frame, size } = wet;
  const opts = { cap: (i: number) => (basin[i] ? WETNESS.moist : WETNESS.deep), water: (x: number, y: number) => texelAt(textures, x, y, seed, frame, size)('water') };
  return paintGroundWater(scene.ground, wet, state, opts, scene.view.squash);
}
