import { offsetNeighbours, offsetToPixel, pixelToOffset } from '../math/hex';
import { valueNoise2D } from '../math/noise';
import { coverAt, elevationAt, inGrid, type CoverGrid } from './coverGrid';
import { createCoverField, type CoverField } from './coverField';
import type { GridFrame } from './geometry';
import { shadeGround } from './groundShader';
import { MAX_ELEVATION, zeroAmounts } from './levels';
import type { GroundTextures } from './placeholderTextures';
import { createRaster, sampleVariants, setPixel, type Raster } from './raster';
import { MOUNTAIN_FROM, RELIEF_BLEND, lakeHeight, ridgeNoise, shadeSlopes, terrainHeight, type ReliefOptions } from './relief';

/** Size of the patches in which one texture variant dominates, in hex radii. */
const VARIANT_PATCH = 2.5;
/** Water amount above which a point shows open water (matches the shader's waterline). */
const OPEN_WATER = 0.4;

/** The map's ground as seen from above, plus what the 3D view needs per pixel. */
export interface Terrain {
  ground: Raster;
  /** Height above the floor in screen pixels, per ground pixel. */
  heights: Float32Array;
  /** Hex row each ground pixel belongs to, or -1 off the map. */
  rows: Int16Array;
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
 * each pixel's height: almost flat floor, continuous mountains with ridges,
 * and lakes lying flat at their own level. Slopes are then shaded by the light.
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
      const e = reliefField.sample(lx, ly, r).alt * MAX_ELEVATION;
      heights[i] =
        lake !== undefined
          ? lakeHeight(lake, relief)
          : terrainHeight(e, e > MOUNTAIN_FROM - 0.5 ? ridgeNoise(lx, ly, size, seed) : 0.5, relief);
    }
  }
  shadeSlopes(ground, heights);
  return { ground, heights, rows };
}
