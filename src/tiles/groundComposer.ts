import { offsetNeighbours, offsetToPixel, pixelToOffset } from '../math/hex';
import { valueNoise2D } from '../math/noise';
import { coverAt, elevationAt, inGrid, type CoverGrid } from './coverGrid';
import { createCoverField, type CoverField } from './coverField';
import type { GridFrame } from './geometry';
import { shadeGround } from './groundShader';
import { MAX_ELEVATION, zeroAmounts } from './levels';
import type { GroundTextures } from './placeholderTextures';
import { createRaster, sampleVariants, setPixel, type Raster } from './raster';
import type { Pixel } from '../math/hex';
import { lakeOutlets } from './hydrology';
import { fallLips, fillPoolHoles, markFalls, paintPoolRims, paintSplash, shadePoolFoot, tidyPool } from './pools';
import {
  MOUNTAIN_FROM,
  RELIEF_BLEND,
  blurHeights,
  landHeight,
  ridgeNoise,
  shadeSlopes,
  waterHeight,
  type ReliefOptions,
} from './relief';

/** Size of the patches in which one texture variant dominates, in hex radii. */
const VARIANT_PATCH = 2.5;
/** Water amount above which a point shows open water (matches the shader's waterline). */
const OPEN_WATER = 0.4;
/** Relief is shallow (one hex row at most), so slopes are lit a bit more strongly than real. */
const SLOPE_SHADING = 1.8;

/** The map's ground as seen from above, plus what the 3D view needs per pixel. */
export interface Terrain {
  ground: Raster;
  /** Height above the floor in screen pixels, per ground pixel. */
  heights: Float32Array;
  /** Hex row each ground pixel belongs to, or -1 off the map. */
  rows: Int16Array;
  /** 1 where water pours over a lake's outlet edge: its drop is drawn as a waterfall. */
  falls: Uint8Array;
  /** 1 where the ground is raised water (a high lake). */
  pool: Uint8Array;
  /** Per raised lake, the pool pixel it pours out over (frame pixels). */
  lips: Pixel[];
}

/** Width of the waterfall along a pool's rim, in hex radii. */
const FALL_WIDTH = 0.5;
/** Width of the stone lip around raised water, in hex radii. */
const RIM_WIDTH = 0.06;
/** Reach of the foam at a waterfall's foot, in hex radii. */
const SPLASH_RADIUS = 0.3;
/** Radius of the smoothing of a raised lake's edge, and the side of the smallest lake kept, in hex radii. */
const POOL_SMOOTH = 0.08;
const POOL_MIN = 0.5;
/** Depth of the shadow on the ground in front of a raised lake, in hex radii. */
const FOOT_SHADOW = 0.25;

/**
 * Where each raised lake pours out: the midpoint of the edge between its
 * basin and the lowest neighbour it overflows into (grid-local pixels).
 */
function outletPoints(grid: CoverGrid, size: number): Pixel[] {
  const isLake = (i: number) => grid.cells[i].water >= 2 && grid.elevation[i] > 0.5;
  const centre = (i: number) => offsetToPixel(i % grid.cols, Math.floor(i / grid.cols), size);
  return lakeOutlets(grid, isLake)
    .filter(({ from }) => from >= 0)
    .map(({ from, to }) => {
      const [a, b] = [centre(from), centre(to)];
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

/**
 * Paint the whole map's ground as one continuous top-down image, and work out
 * each pixel's height: almost flat floor, continuous mountains with ridges
 * (relief style only), and lakes lying flat at their own level, pouring over
 * their outlet as a waterfall. Slopes are then shaded by the light.
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
  const ground = createRaster(W, H);
  const heights = new Float32Array(W * H);
  const rows = new Int16Array(W * H).fill(-1);
  const pool = new Uint8Array(W * H);
  const a = zeroAmounts();
  const r = zeroAmounts();
  const reliefField = createCoverField(grid, size, RELIEF_BLEND);
  const vScale = 1 / (VARIANT_PATCH * size);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const lx = x + 0.5 - frame.ox;
      const ly = y + 0.5 - frame.oy;
      const hex = pixelToOffset(lx, ly, size);
      if (!inGrid(grid, hex.col, hex.row)) continue;
      const i = y * W + x;
      rows[i] = hex.row;
      terrain.sample(lx, ly, a);
      const t = valueNoise2D(lx * vScale, ly * vScale, seed + 101);
      setPixel(ground, x, y, shadeGround(a, (kind) => sampleVariants(textures[kind], x, y, t)));

      const lake = a.water > OPEN_WATER ? lakeLevelNear(grid, hex.col, hex.row, lx, ly, size) : undefined;
      if (lake !== undefined) {
        heights[i] = waterHeight(lake, relief);
        pool[i] = heights[i] > 0 ? 1 : 0; // sea level water is not a pool
        continue;
      }
      if (relief.style === 'sprites') continue; // flat land: mountains are sprites
      const e = reliefField.sample(lx, ly, r).alt * MAX_ELEVATION;
      heights[i] = landHeight(e, e > MOUNTAIN_FROM - 0.5 ? ridgeNoise(lx, ly, size, seed) : 0.5, relief);
    }
  }
  fillPoolHoles(pool, heights, W, H);
  // Relief land has its own height under a pool's edge; flat sprite land would show ragged slivers of cliff.
  if (relief.style === 'sprites') tidyPool(pool, heights, W, H, Math.max(1, Math.round(size * POOL_SMOOTH)), (size * POOL_MIN) ** 2);
  const outlets = outletPoints(grid, size).map((p) => ({ x: p.x + frame.ox, y: p.y + frame.oy }));
  const lips = fallLips(pool, W, outlets);
  const falls = markFalls(pool, W, H, lips, FALL_WIDTH * size);
  if (relief.style !== 'sprites') {
    // Sprite style keeps land flat and pool edges crisp: nothing to smooth or shade.
    blurHeights(heights, W, H, Math.max(1, Math.round(size * 0.08)));
    shadeSlopes(ground, heights, SLOPE_SHADING);
  }
  paintPoolRims(ground, heights, pool, falls, Math.max(1, Math.round(size * RIM_WIDTH)));
  paintSplash(ground, pool, falls, Math.round(size * SPLASH_RADIUS));
  shadePoolFoot(ground, pool, Math.round(size * FOOT_SHADOW));
  return { ground, heights, rows, falls, pool, lips };
}
