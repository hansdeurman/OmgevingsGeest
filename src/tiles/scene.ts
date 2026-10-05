import type { Pixel } from '../math/hex';
import { shade, type RGB } from '../rendering/palette';
import { forEachCell, inGrid, type CoverGrid } from './coverGrid';
import { offsetNeighbours, pixelToOffset } from '../math/hex';
import { frameCentre, gridFrame, isoSideFaces, isoTop, toIso, type GridFrame, type IsoView } from './geometry';
import { composeTerrain, texelAt, type BaseTerrain, type Cascade } from './groundComposer';
import type { GroundDetail } from './wetGround';
import { onRiver, paintWaterLook, waterLook, wetLayer, type GroundWaterState, type RiverMask, type WaterLook, type WetLayer } from './groundWater';
import type { Cover } from './levels';
import type { GroundTextures } from './placeholderTextures';
import { PROP_RULES, type PropRule } from './propRules';
import { ridgeProps } from './ridges';
import { DEFAULT_WEATHER, placeholderLakeKit, type LakeKit, type Weather } from './highLakes';
import type { LakeImage } from './lakePainter';
import { createRaster, getPixel, squashRaster, type Raster } from './raster';
import { basinOutflow, findBasins, settleProps, type Basin } from './waterLayer';
import type { LakeSetup } from './lakeJob';
import { syncLakes, type LakeSource } from './lakeSource';
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
  /** Where the high basins' lakes get painted: right away, if absent, or elsewhere (a worker). */
  lakeSource?: LakeSource;
  /** The base terrain, if it was painted already (in workers, see basePool); painted here if absent. */
  base?: BaseTerrain;
  /** The ground's detail (puddle spots, cracks), if it was made already; made here if absent. */
  detail?: GroundDetail;
  /** The flat map's ground is graded by the water elsewhere (on the GPU, from the scene's `look`): only work out the look. */
  groundElsewhere?: boolean;
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
  /** On the flat map with a water model: how its ground is repainted as the water changes. */
  wet?: WetLayer;
  /** What painting its lakes needs, and where they get painted. */
  lakes: { setup: LakeSetup; source: LakeSource };
  /** The flat map's ground as it is now, projected: drawn whole, under every band's props, instead of the bands' slices… */
  flat?: Raster;
  /** …and where its rivers run now… */
  river?: RiverMask;
  /** …and the water's look it was graded by (to grade it elsewhere). */
  look?: WaterLook;
  /** What the props were last settled around (which the rivers hide, the lakes): while that stays, so do the bands; and paints since. */
  settled?: { hidden: Uint8Array; lakes: LakeImage[]; bands: SceneBand[]; age: number };
}

/** A basin's water (steps) may move this much before its lake is painted anew: less does not show. */
export const LAKE_SETTLES = 0.02;
/** Its outflow counts this much per step of water, so a change of a few hundredths repaints its stream. */
const OUTFLOW_WEIGHT = 0.5;

/** What painting the high lakes needs from the scene options. */
export type LakeOptions = Pick<SceneOptions, 'hexSize' | 'view' | 'weather' | 'groundElsewhere'> & {
  /** Props settle around changed rivers and lakes at most once in this many paints (while the water plays, a little late is fine); every paint if absent. */
  settleEvery?: number;
};

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
  const t = composeTerrain(terrain, grid, textures, frame, size, seed, opts.relief, opts.highWater, !live, opts.base);
  const { ground, heights } = t;
  const bandOf = new Int16Array(t.rows.length);
  for (let i = 0; i < bandOf.length; i++) bandOf[i] = t.rows[i] < 0 ? -1 : Math.floor(Math.floor(i / frame.width) / BAND_ROWS);
  const faces = { wall: opts.cliff, pool: opts.poolFace, pools: t.pool, falls: t.falls };
  // The flat map raises nothing, so its ground is drawn whole, projected; only the relief style needs slices.
  const slices = flat ? flatSlices(bandOf, view.squash, frame.width) : sliceTerrain(ground, heights, bandOf, view.squash, faces);
  const bands: SceneBand[] = slices.map((slice) => ({ slice, props: [], land: [] }));

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
  const wet = live ? wetLayer(grid.cols, grid.rows, frame, size, keepMask(t.rows, t.open), seed, opts.detail) : undefined;
  const projected = flat ? squashRaster(ground, view.squash) : undefined;
  const setup: LakeSetup = { cols: grid.cols, rows: grid.rows, frame, size, squash: view.squash, basins, kit: opts.lakes ?? placeholderLakeKit(size), rims: textures, floor: ground };
  const lakes = { setup, source: opts.lakeSource ?? syncLakes(LAKE_SETTLES) };
  return paintLakes({ frame, view, hexSize: size, ground, heights, tiles, bands, grid, basins, wet, flat: projected, lakes }, textures, opts, opts.water ?? { depth: full });
}

const byDepth = (a: PropInstance, b: PropInstance) => a.y - b.y;

/** Pixels the water leaves alone: off the map and open water. */
function keepMask(rows: Int16Array, open: Uint8Array): Uint8Array {
  const keep = new Uint8Array(rows.length);
  for (let i = 0; i < keep.length; i++) keep[i] = rows[i] < 0 || open[i] ? 1 : 0;
  return keep;
}

/** Slices of the flat map: only where each band starts, its ground being drawn whole. */
function flatSlices(bandOf: Int16Array, squash: number, width: number): Slice[] {
  let count = 0;
  for (const b of bandOf) if (b >= count) count = b + 1;
  return Array.from({ length: count }, (_, index) => ({ index, top: Math.floor(index * BAND_ROWS * squash), raster: createRaster(width, 0) }));
}

/**
 * The scene with its water painted as it stands now: the high basins' water
 * as lakes, each one object drawn where its near shore stands, what the water
 * covers hidden, peaks and islands standing on it; and wherever water runs,
 * rivers on the ground. The land is shared, not rebuilt, so this is quick
 * enough to play a simulation.
 */
export function paintLakes(scene: Scene, textures: GroundTextures, opts: LakeOptions, { depth, flux, topo, ground, wetness, river }: SceneWater): Scene {
  const { view } = opts;
  const look = scene.wet && wetness ? lookNow(scene, scene.wet, { wetness, river, ground: ground ?? scene.grid.elevation }) : undefined;
  const flat = look && !opts.groundElsewhere ? paintLook(scene, scene.wet!, textures, look) : scene.flat;
  // Which land props the rivers hide, in band order; one hidden stays so while the river runs close by, so a river's edge shifting a pixel does not make props blink (and the bands settle again).
  const before = scene.settled?.hidden;
  const hidden = Uint8Array.from(scene.bands.flatMap((b) => b.land), (p, k) => (look && (onRiver(look.river, p.x, p.y) || (before?.[k] === 1 && nearRiver(look.river, p.x, p.y))) ? 1 : 0));
  const weather = opts.weather ?? DEFAULT_WEATHER;
  const cells = { ground: ground ?? scene.grid.elevation, depth };
  const tag = JSON.stringify(weather);
  const lakes = scene.basins.flatMap((basin, k) => {
    const settled = [...basin.cells.map((i) => cells.depth[i]), ...basin.cells.map((i) => cells.ground[i]), flux && topo ? OUTFLOW_WEIGHT * basinOutflow(topo, flux, basin.cells) : 0];
    const job = { basin: k, ...cells, flux: topo && flux, dirs: topo?.dirs, weather };
    return scene.lakes.source(scene.lakes.setup, job, settled, tag);
  });
  // Settling props costs: while the rivers' beds and the lakes are as before, the bands are too; and they settle again at most every `settleEvery` paints.
  const was = scene.settled;
  const unchanged = was && same(was.hidden, hidden) && same(was.lakes, lakes);
  if (was && (unchanged || was.age + 1 < (opts.settleEvery ?? 1))) return { ...scene, bands: was.bands, flat, river: look?.river, look, settled: { ...was, age: was.age + 1 } };
  const bands = settleBands(scene.bands, lakes, hidden, view.squash);
  return { ...scene, bands, flat, river: look?.river, look, settled: { hidden, lakes, bands, age: 0 } };
}

/** Whether the rivers cover pixel (x, y) or a cell beside it. */
function nearRiver(m: RiverMask, x: number, y: number): boolean {
  const c = m.cell;
  return onRiver(m, x - c, y) || onRiver(m, x + c, y) || onRiver(m, x, y - c) || onRiver(m, x, y + c);
}

/** The bands with their land props settled: those `hidden` (by rivers, in band order) left out, hidden under or riding on the lakes, which stand in the band of their foot. */
function settleBands(land: readonly SceneBand[], lakes: readonly LakeImage[], hidden: Uint8Array, squash: number): SceneBand[] {
  const riders = lakes.map((): PropInstance[] => []);
  let next = 0;
  const bands = land.map((b) => {
    const shown = b.land.filter(() => !hidden[next++]);
    const settled = settleProps(shown, lakes.map((l) => l.surface), squash);
    settled.riders.forEach((r, k) => riders[k].push(...r));
    return { ...b, props: settled.kept };
  });
  lakes.forEach((img, l) => {
    const footY = img.surface.y0 + img.surface.height;
    const band = bands[bandIndex(bands, footY)];
    band.props = [...band.props, { ...lakeProp(img, footY, squash), riders: riders[l].sort(byDepth) }].sort(byDepth);
  });
  return bands;
}

const same = <T,>(a: ArrayLike<T>, b: ArrayLike<T>) => a.length === b.length && Array.prototype.every.call(a, (v: T, i: number) => v === b[i]);

/** The water's look on the flat map now; high basins' water is drawn apart, so they at most look moist. */
function lookNow(scene: Scene, wet: WetLayer, state: GroundWaterState): WaterLook {
  const basin = new Uint8Array(scene.grid.cols * scene.grid.rows);
  for (const b of scene.basins) for (const i of b.cells) basin[i] = 1;
  return waterLook(scene.ground.width, scene.ground.height, wet, state, (i) => (basin[i] ? WETNESS.moist : WETNESS.deep), scene.view.squash);
}

/** The flat map's ground graded by the water's look, with its rivers, projected. */
function paintLook(scene: Scene, wet: WetLayer, textures: GroundTextures, look: WaterLook): Raster {
  const { seed, frame, size } = wet;
  return paintWaterLook(scene.ground, wet, look, (x, y) => texelAt(textures, x, y, seed, frame, size)('water'), scene.view.squash);
}
