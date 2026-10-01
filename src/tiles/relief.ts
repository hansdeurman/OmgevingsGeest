import { fbm2D } from '../math/noise';
import { clamp, smoothstep } from '../math/scalar';
import { mix, shade, type RGB } from '../rendering/palette';
import { MAX_ELEVATION } from './levels';
import { createRaster, getPixel, sampleRaster, setPixel, type Raster } from './raster';

/**
 * Relief: the floor stays almost flat (hills only nudge it), and mountains
 * rise as one continuous height field, so neighbouring mountain hexes merge
 * into a single wall with ridges, and basins between them can hold lakes.
 */
export interface ReliefOptions {
  /** Height of the highest mountains, in screen pixels. */
  mountain: number;
  /** Lift per elevation step below the mountains, in screen pixels. */
  hill: number;
}

/** Elevation (terrace steps) from which land turns into mountain. */
export const MOUNTAIN_FROM = 4;

/** Mountain height is scaled by RIDGE_MIN + RIDGE_SPAN × ridge noise. */
const RIDGE_MIN = 0.7;
const RIDGE_SPAN = 0.6;
/** Kernel width (hex radii) of the elevation blend used for heights: wider than cover, for smooth massifs. */
export const RELIEF_BLEND = 1.05;

function parts(e: number, o: ReliefOptions): [number, number] {
  const hills = Math.min(e, MOUNTAIN_FROM) * o.hill;
  const mountain = o.mountain * smoothstep(MOUNTAIN_FROM - 0.5, MAX_ELEVATION, e) ** 1.2;
  return [hills, mountain];
}

/** Ground height for an elevation (in steps) and a ridge value in [0, 1]. */
export function terrainHeight(e: number, ridge: number, o: ReliefOptions): number {
  const [hills, mountain] = parts(e, o);
  return hills + mountain * (RIDGE_MIN + RIDGE_SPAN * ridge);
}

/** A lake lies flat at the lowest ridge height of its elevation, so its rim always rises above it. */
export function lakeHeight(e: number, o: ReliefOptions): number {
  const [hills, mountain] = parts(e, o);
  return hills + mountain * RIDGE_MIN;
}

/** Sharp-crested ridge noise in [0, 1]; crests are thin, valleys broad. */
export function ridgeNoise(x: number, y: number, size: number, seed: number): number {
  const n = fbm2D(x / (1.7 * size), y / (1.7 * size), { seed: seed + 777, octaves: 3, persistence: 0.45, lacunarity: 2 });
  return clamp(1 - Math.abs(2 * n - 1) * 1.6, 0, 1) ** 1.2;
}

/** Light from the left and slightly from the front, as for the sprites. */
const LIGHT = (() => {
  const l = [-0.62, 0.22, 0.75];
  const len = Math.hypot(...l);
  return l.map((v) => v / len);
})();

/** Darken or lighten each ground pixel by how its slope faces the light. Flat ground is unchanged. */
export function shadeSlopes(ground: Raster, heights: Float32Array, strength = 1): void {
  const { width: W, height: H } = ground;
  const h = (x: number, y: number) => heights[clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1)];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b, a] = getPixel(ground, x, y);
      if (!a) continue;
      const hx = (h(x + 1, y) - h(x - 1, y)) / 2;
      const hy = (h(x, y + 1) - h(x, y - 1)) / 2;
      if (hx === 0 && hy === 0) continue;
      const lit = (-hx * LIGHT[0] - hy * LIGHT[1] + LIGHT[2]) / Math.hypot(hx, hy, 1) / LIGHT[2];
      const k = clamp(1 + (lit - 1) * strength, 0.55, 1.35);
      setPixel(ground, x, y, shade([r, g, b], k), a);
    }
  }
}

/** One hex row's worth of rendered terrain; `top` is its first screen row (scene pixels). */
export interface Slice {
  row: number;
  top: number;
  raster: Raster;
}

/**
 * Project the top-down ground into the squashed view with heights, one
 * slice per hex row so the renderer can interleave each row's props.
 * Every ground pixel paints a vertical span from its raised position down to
 * where the next pixel toward the viewer starts; steep spans become cliff
 * faces textured with `wall`. Later (nearer) pixels paint over earlier ones.
 */
export function sliceTerrain(ground: Raster, heights: Float32Array, rows: Int16Array, squash: number, wall?: Raster): Slice[] {
  const { width: W, height: H } = ground;
  const span = (x: number, y: number): [number, number] => {
    const i = y * W + x;
    const top = y * squash - heights[i];
    const next = y + 1 < H && rows[i + W] >= 0 ? (y + 1) * squash - heights[i + W] : (y + 1) * squash;
    return [top, Math.max(top + 1, next)];
  };

  let rowCount = 0;
  for (const r of rows) if (r >= rowCount) rowCount = r + 1;
  const tops = new Array<number>(rowCount).fill(Infinity);
  const bottoms = new Array<number>(rowCount).fill(-Infinity);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = rows[y * W + x];
      if (r < 0) continue;
      const [t, b] = span(x, y);
      tops[r] = Math.min(tops[r], Math.floor(t));
      bottoms[r] = Math.max(bottoms[r], Math.ceil(b));
    }
  }
  const slices: Slice[] = tops.map((top, row) => ({
    row,
    top: Number.isFinite(top) ? top : 0,
    raster: createRaster(W, Number.isFinite(top) ? bottoms[row] - top : 0),
  }));

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = rows[y * W + x];
      if (r < 0) continue;
      const [t, b] = span(x, y);
      const t0 = Math.floor(t);
      const cliff = b - t > 2.5;
      const [cr, cg, cb] = getPixel(ground, x, y);
      const slice = slices[r];
      for (let py = t0; py < Math.ceil(b); py++) {
        const k = py - t0;
        let c: RGB = [cr, cg, cb];
        if (cliff && k >= 1) {
          const snowy = cr + cg + cb > 3 * 215;
          c = shade(c, snowy ? 0.88 : 0.78);
          if (wall && !snowy) c = mix(c, shade(sampleRaster(wall, x, py), 0.9), smoothstep(0, 4, k) * 0.85);
        }
        setPixel(slice.raster, x, py - slice.top, c);
      }
    }
  }
  return slices;
}
