import { offsetNeighbours, offsetToPixel, pixelToOffset } from '../math/hex';
import { valueNoise2D } from '../math/noise';
import { smoothstep } from '../math/scalar';
import { coverAt, elevationAt, inGrid, type CoverGrid } from './coverGrid';
import { createCoverField, type CoverField } from './coverField';
import type { GridFrame } from './geometry';
import { shadeGround, type GroundKind, type TexelLookup } from './groundShader';
import { MAX_ELEVATION, zeroAmounts } from './levels';
import type { GroundTextures } from './placeholderTextures';
import { createRaster, sampleVariants, setPixel, type Raster } from './raster';
import type { Pixel } from '../math/hex';
import { lakeOutlets } from './hydrology';
import { fallLips, fillPoolHoles, markFalls, paintPoolRims, paintSplash, shadePoolFoot } from './pools';
import { lakeRivers, riverStroke, smoothPath, type River } from './rivers';
import {
  MOUNTAIN_FROM,
  RELIEF_BLEND,
  blurHeights,
  lakeHeight,
  paintContours,
  ridgeNoise,
  shadeSlopes,
  terrainHeight,
  type ReliefOptions,
} from './relief';

/** Size of the patches in which one texture variant dominates, in hex radii. */
const VARIANT_PATCH = 2.5;
/** Water amount above which a point shows open water (matches the shader's waterline). */
const OPEN_WATER = 0.4;
/** Relief is shallow (one hex row at most), so slopes are lit a bit more strongly than real. */
const SLOPE_SHADING = 1.8;
/** On the flat map, slopes are only shaded (hillshade), so they are lit more strongly still. */
const HILLSHADE = 2.6;

/** A waterfall sprite: where it stands (frame px, its foot) and how tall it is drawn (px). */
export interface Cascade {
  at: Pixel;
  height: number;
}

/** The map's ground as seen from above, plus what the view needs per pixel. */
export interface Terrain {
  ground: Raster;
  /** Height above the floor in screen pixels, per ground pixel (all 0 on the flat map). */
  heights: Float32Array;
  /** Hex row each ground pixel belongs to, or -1 off the map. */
  rows: Int16Array;
  /** 1 where water pours over a raised lake's edge: its drop is drawn as a waterfall (relief style). */
  falls: Uint8Array;
  /** 1 where the ground stands on a cliff: a raised lake (relief style). */
  pool: Uint8Array;
  /** Rivers from the high lakes down to the sea, as cells. */
  rivers: River[];
  /** 1 on river pixels: props keep off them. */
  river: Uint8Array;
  cascades: Cascade[];
}

/** Width of the waterfall along a pool's rim, in hex radii. */
const FALL_WIDTH = 0.5;
/** Width of the stone lip around raised water, in hex radii. */
const RIM_WIDTH = 0.06;
/** Reach of the foam at a waterfall's foot, in hex radii. */
const SPLASH_RADIUS = 0.3;
/** Depth of the shadow on the ground in front of a raised lake, in hex radii. */
const FOOT_SHADOW = 0.25;
/** Share of a waterfall sprite's height from its rim down to the bottom of its splash. */
const FALL_DROP_SHARE = 0.85;
/** River width at its source and at its mouth, in hex radii. */
const RIVER_WIDTH: [number, number] = [0.22, 0.42];
/** Height of a cascade sprite on the flat map, in hex radii. */
const CASCADE_SIZE = 0.7;

const isLakeCell = (grid: CoverGrid) => (i: number) => grid.cells[i].water >= 2 && grid.elevation[i] > 0.5;
const isSeaCell = (grid: CoverGrid) => (i: number) => grid.cells[i].water >= 2 && grid.elevation[i] <= 0.5;
const cellCentre = (grid: CoverGrid, i: number, size: number, frame: GridFrame): Pixel => {
  const p = offsetToPixel(i % grid.cols, Math.floor(i / grid.cols), size);
  return { x: p.x + frame.ox, y: p.y + frame.oy };
};

/**
 * Where each raised lake pours out: the midpoint of the edge between its
 * basin and the lowest neighbour it overflows into (frame pixels).
 */
function outletPoints(grid: CoverGrid, size: number, frame: GridFrame): Pixel[] {
  return lakeOutlets(grid, isLakeCell(grid))
    .filter(({ from }) => from >= 0)
    .map(({ from, to }) => {
      const [a, b] = [cellCentre(grid, from, size, frame), cellCentre(grid, to, size, frame)];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    });
}

/** Surface elevation of the nearest open-water hex (this one or a neighbour), if any. */
function lakeLevelNear(grid: CoverGrid, col: number, row: number, x: number, y: number, size: number): number | undefined {
  let best: number | undefined;
  let bestDist = Infinity;
  const visit = (c: number, r: number) => {
    if ((coverAt(grid, c, r)?.water ?? 0) < 2) return;
    const p = offsetToPixel(c, r, size);
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestDist) [best, bestDist] = [elevationAt(grid, c, r), d];
  };
  visit(col, row);
  for (const d of offsetNeighbours(row)) visit(col + d.dc, row + d.dr);
  return best;
}

/** The painted ground plus, per pixel, the relief and the water on it. */
interface BaseTerrain {
  ground: Raster;
  /** Relief height in screen pixels: land with ridges, lakes flat at their level. */
  field: Float32Array;
  /** Elevation in steps (lake surface on water); -Infinity off the map. */
  elevation: Float32Array;
  rows: Int16Array;
  /** 1 on open water above sea level (a high lake). */
  lake: Uint8Array;
  /** 1 on open water of any kind. */
  open: Uint8Array;
}

function paintBase(
  terrain: CoverField,
  grid: CoverGrid,
  textures: GroundTextures,
  frame: GridFrame,
  size: number,
  seed: number,
  relief: ReliefOptions,
): BaseTerrain {
  const { width: W, height: H } = frame;
  const ground = createRaster(W, H);
  const field = new Float32Array(W * H);
  const elevation = new Float32Array(W * H).fill(-Infinity);
  const rows = new Int16Array(W * H).fill(-1);
  const lake = new Uint8Array(W * H);
  const open = new Uint8Array(W * H);
  const a = zeroAmounts();
  const r = zeroAmounts();
  const reliefField = createCoverField(grid, size, RELIEF_BLEND);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const lx = x + 0.5 - frame.ox;
      const ly = y + 0.5 - frame.oy;
      const hex = pixelToOffset(lx, ly, size);
      if (!inGrid(grid, hex.col, hex.row)) continue;
      const i = y * W + x;
      rows[i] = hex.row;
      terrain.sample(lx, ly, a);
      setPixel(ground, x, y, shadeGround(a, texelAt(textures, x, y, seed, frame, size)));

      const level = a.water > OPEN_WATER ? lakeLevelNear(grid, hex.col, hex.row, lx, ly, size) : undefined;
      if (level !== undefined) {
        field[i] = lakeHeight(level, relief);
        elevation[i] = level;
        open[i] = 1;
        lake[i] = field[i] > 0 ? 1 : 0;
        continue;
      }
      const e = reliefField.sample(lx, ly, r).alt * MAX_ELEVATION;
      field[i] = terrainHeight(e, e > MOUNTAIN_FROM - 0.5 ? ridgeNoise(lx, ly, size, seed) : 0.5, relief);
      elevation[i] = e;
    }
  }
  return { ground, field, elevation, rows, lake, open };
}

/** Texture lookup at a frame pixel, with variants chosen by slowly varying noise. */
function texelAt(textures: GroundTextures, x: number, y: number, seed: number, frame: GridFrame, size: number): TexelLookup {
  const vScale = 1 / (VARIANT_PATCH * size);
  const t = valueNoise2D((x + 0.5 - frame.ox) * vScale, (y + 0.5 - frame.oy) * vScale, seed + 101);
  return (kind: GroundKind) => sampleVariants(textures[kind], x, y, t);
}

/**
 * Paint each high lake's river onto the ground, from the lake down to the
 * sea, widening as it goes; open water it crosses stays as it is. Returns
 * the rivers, their pixels and a cascade wherever a river drops steeply.
 */
function paintRivers(base: BaseTerrain, grid: CoverGrid, textures: GroundTextures, frame: GridFrame, size: number, seed: number) {
  const { width: W, height: H } = frame;
  const rivers = lakeRivers(grid, isLakeCell(grid), isSeaCell(grid));
  const mask = new Uint8Array(W * H);
  const cascades: Cascade[] = [];
  const [w0, w1] = RIVER_WIDTH;
  for (const river of rivers) {
    const path = smoothPath(river.cells.map((i) => cellCentre(grid, i, size, frame)), 2);
    for (const [i, centre] of riverStroke(path, W, H, (t) => (w0 + (w1 - w0) * t) * size)) {
      if (base.rows[i] < 0 || base.open[i]) continue;
      const [x, y] = [i % W, Math.floor(i / W)];
      const stream = { ...zeroAmounts(), water: 0.3 + 0.4 * smoothstep(0, 0.6, centre), alt: base.elevation[i] / MAX_ELEVATION };
      setPixel(base.ground, x, y, shadeGround(stream, texelAt(textures, x, y, seed, frame, size)));
      mask[i] = 1;
    }
    for (const [a, b] of river.cascades) {
      const [p, q] = [cellCentre(grid, a, size, frame), cellCentre(grid, b, size, frame)];
      cascades.push({ at: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, height: CASCADE_SIZE * size });
    }
  }
  return { rivers, mask, cascades };
}

/** Heights get projected: raised lakes stand on a cliff and pour over their outlet. */
function raiseRelief(base: BaseTerrain, grid: CoverGrid, frame: GridFrame, size: number) {
  const { width: W, height: H } = frame;
  const { ground, field: heights, lake: pool } = base;
  fillPoolHoles(pool, heights, W, H);
  const lips = fallLips(pool, W, outletPoints(grid, size, frame));
  const falls = markFalls(pool, W, H, lips, FALL_WIDTH * size);
  blurHeights(heights, W, H, Math.max(1, Math.round(size * 0.08)));
  shadeSlopes(ground, heights, SLOPE_SHADING);
  paintPoolRims(ground, heights, pool, falls, Math.max(1, Math.round(size * RIM_WIDTH)));
  paintSplash(ground, pool, falls, Math.round(size * SPLASH_RADIUS));
  shadePoolFoot(ground, pool, Math.round(size * FOOT_SHADOW));
  const cascades = lips.map((at) => ({ at: { x: at.x, y: at.y + 0.5 }, height: heights[Math.floor(at.y) * W + Math.floor(at.x)] / FALL_DROP_SHARE }));
  return { heights, falls, pool, cascades };
}

/**
 * Paint the whole map's ground as one continuous top-down image, with the
 * rivers that run from high lakes to the sea.
 * - 'sprites' (the flat map): nothing is raised, so nothing hides what lies
 *   behind it; height shows as hillshade on the ground (lakes lie flat in
 *   their bowl), optionally with height lines, and mountains are sprites.
 * - 'relief': the heights are projected; raised lakes stand on a cliff.
 * Because it is one image, identical neighbours join without seams and fuse
 * zones run freely across hex edges. Pixels off the map stay transparent.
 */
export function composeTerrain(
  terrain: CoverField,
  grid: CoverGrid,
  textures: GroundTextures,
  frame: GridFrame,
  size: number,
  seed: number,
  relief: ReliefOptions,
): Terrain {
  const { width: W, height: H } = frame;
  const base = paintBase(terrain, grid, textures, frame, size, seed, relief);
  const rivers = paintRivers(base, grid, textures, frame, size, seed);
  const flat = relief.style === 'sprites';
  const shown = flat
    ? (() => {
        blurHeights(base.field, W, H, Math.max(1, Math.round(size * 0.08)));
        shadeSlopes(base.ground, base.field, HILLSHADE);
        const none = new Uint8Array(W * H);
        return { heights: new Float32Array(W * H), falls: none, pool: none, cascades: rivers.cascades };
      })()
    : raiseRelief(base, grid, frame, size);
  if (relief.contours) paintContours(base.ground, base.elevation, 1);
  return { ground: base.ground, rows: base.rows, rivers: rivers.rivers, river: rivers.mask, ...shown };
}
