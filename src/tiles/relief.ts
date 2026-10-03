import { fbm2D } from '../math/noise';
import { clamp, smoothstep } from '../math/scalar';
import { mix, shade, type RGB } from '../rendering/palette';
import { MAX_ELEVATION } from './levels';
import { waterfallColor } from './pools';
import { createRaster, getPixel, sampleRaster, setPixel, type Raster } from './raster';

/**
 * Relief: low land stays almost flat and height grows gently with elevation,
 * so the highest mountains rise one hex row above the floor. Mountains are one
 * continuous height field: neighbouring mountain hexes merge into a single
 * wall with ridges, and basins between them hold lakes at their own level.
 */
/**
 * 'relief': the height field is projected, mountains are part of it.
 * 'sprites': the flat map: nothing is raised, height shows as hillshade and
 * mountains are sprites.
 */
export type MountainStyle = 'relief' | 'sprites';

export interface ReliefOptions {
  /** Height of the highest ground, in screen pixels (about one hex row). */
  height: number;
  style?: MountainStyle;
  /** Draw height lines (one per elevation step) on the ground. */
  contours?: boolean;
}

/** Elevation (terrace steps) from which land turns into mountain and gets ridges. */
export const MOUNTAIN_FROM = 4;
/** Ridge noise varies mountain height by up to ± half this share. */
const RIDGE_AMP = 0.4;
/** Kernel width (hex radii) of the elevation blend used for heights: wider than cover, for smooth massifs. */
export const RELIEF_BLEND = 1.05;

/** Share of the full height at an elevation: flat near sea level, steeper toward the peaks. */
const curve = (e: number) => clamp(e / MAX_ELEVATION, 0, 1) ** 1.5;
const mountainness = (e: number) => smoothstep(MOUNTAIN_FROM - 0.5, MAX_ELEVATION, e);

/** Ground height for an elevation (in steps) and a ridge value in [0, 1]. */
export function terrainHeight(e: number, ridge: number, o: ReliefOptions): number {
  return o.height * curve(e) * (1 + RIDGE_AMP * (ridge - 0.5) * mountainness(e));
}

/** A lake lies flat at the lowest ridge height of its elevation, so its rim always rises above it. */
export function lakeHeight(e: number, o: ReliefOptions): number {
  return o.height * curve(e) * (1 - RIDGE_AMP * 0.5 * mountainness(e));
}

/** Sharp-crested ridge noise in [0, 1]; crests are thin, valleys broad. */
export function ridgeNoise(x: number, y: number, size: number, seed: number): number {
  const n = fbm2D(x / (1.7 * size), y / (1.7 * size), { seed: seed + 777, octaves: 3, persistence: 0.45, lacunarity: 2 });
  return clamp(1 - Math.abs(2 * n - 1) * 1.6, 0, 1) ** 1.2;
}

/** Box-blur along one axis, clamping at the borders. */
function blurAxis(src: Float32Array, dst: Float32Array, W: number, H: number, r: number, horizontal: boolean): void {
  // Along a line: element k at start + k * stride. Plain numbers: this runs for every pixel of the map, four times.
  const [n, lines, stride, next] = horizontal ? [W, H, 1, W] : [H, W, W, 1];
  const span = 2 * r + 1;
  for (let line = 0, start = 0; line < lines; line++, start += next) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[start + (k < 0 ? 0 : k > n - 1 ? n - 1 : k) * stride];
    for (let k = 0; k < n; k++) {
      dst[start + k * stride] = sum / span;
      const add = k + r + 1 > n - 1 ? n - 1 : k + r + 1;
      const drop = k - r < 0 ? 0 : k - r;
      sum += src[start + add * stride] - src[start + drop * stride];
    }
  }
}

/**
 * Smooth the height map in place (two box passes per axis ≈ gaussian), so
 * tiny steps where the blend kernel changes hexes don't show up as lines.
 */
export function blurHeights(heights: Float32Array, W: number, H: number, radius: number): void {
  const tmp = new Float32Array(heights.length);
  for (let pass = 0; pass < 2; pass++) {
    blurAxis(heights, tmp, W, H, radius, true);
    blurAxis(tmp, heights, W, H, radius, false);
  }
}

/** How dark a contour line is drawn. */
const CONTOUR_SHADE = 0.62;

/**
 * Height lines, as on a walking map: darken each pixel where the elevation
 * (`elevation`, in steps; -Infinity off the map) crosses a multiple of `step`
 * toward its right or lower neighbour. Level ground, like a lake, gets none.
 */
export function paintContours(ground: Raster, elevation: Float32Array, step: number): void {
  const { width: W, height: H } = ground;
  const band = (i: number) => Math.floor(elevation[i] / step);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!Number.isFinite(elevation[i])) continue;
      const crosses = (j: number) => Number.isFinite(elevation[j]) && band(j) !== band(i);
      if (!(x + 1 < W && crosses(i + 1)) && !(y + 1 < H && crosses(i + W))) continue;
      const [r, g, b, a] = getPixel(ground, x, y);
      if (a) setPixel(ground, x, y, shade([r, g, b], CONTOUR_SHADE), a);
    }
  }
}

/** Light from the left and slightly from the front, as for the sprites. */
const LIGHT = (() => {
  const l = [-0.62, 0.22, 0.75];
  const len = Math.hypot(...l);
  return l.map((v) => v / len);
})();

/** Darken or lighten each ground pixel by how its slope faces the light. Flat ground is unchanged. */
export function shadeSlopes(ground: Raster, heights: Float32Array, strength = 1): void {
  const { width: W, height: H, data } = ground;
  const [lx, ly, lz] = LIGHT;
  // Plain numbers in place: this runs for every pixel of the map.
  for (let y = 0; y < H; y++) {
    const [up, down] = [(y > 0 ? y - 1 : 0) * W, (y < H - 1 ? y + 1 : H - 1) * W];
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      if (!data[o + 3]) continue;
      const hx = (heights[y * W + (x < W - 1 ? x + 1 : W - 1)] - heights[y * W + (x > 0 ? x - 1 : 0)]) / 2;
      const hy = (heights[down + x] - heights[up + x]) / 2;
      if (hx === 0 && hy === 0) continue;
      const lit = (-hx * lx - hy * ly + lz) / Math.sqrt(hx * hx + hy * hy + 1) / lz;
      const k = clamp(1 + (lit - 1) * strength, 0.55, 1.35);
      data[o] *= k; // the array clamps to 0–255
      data[o + 1] *= k;
      data[o + 2] *= k;
    }
  }
}

/** One group's worth of rendered terrain; `top` is its first screen row (scene pixels). */
export interface Slice {
  index: number;
  top: number;
  raster: Raster;
}

/** What steep faces show: rock `wall` (tiled), a raised pool's `pool` face (stretched over the drop), or a waterfall. */
export interface CliffFaces {
  wall?: Raster;
  /** Painted cliff for raised water, from its rim (top row) to the floor (bottom row). */
  pool?: Raster;
  /** 1 where a pixel is raised water, so its drop shows `pool`. */
  pools?: Uint8Array;
  /** 1 where water pours over the edge. */
  falls?: Uint8Array;
}

/**
 * Project the top-down ground into the squashed view with heights, one
 * slice per group (`groups` assigns each ground pixel a group, -1 = off the
 * map) so the renderer can interleave props between slices.
 * Every ground pixel paints a vertical span from its raised position down to
 * where the next pixel toward the viewer starts; steep spans become cliff
 * faces (see CliffFaces).
 * Later (nearer) pixels paint over earlier ones.
 */
export function sliceTerrain(
  ground: Raster,
  heights: Float32Array,
  groups: Int16Array,
  squash: number,
  { wall, pool, pools, falls }: CliffFaces = {},
): Slice[] {
  const { width: W, height: H } = ground;
  const span = (x: number, y: number): [number, number] => {
    const i = y * W + x;
    const top = y * squash - heights[i];
    const next = y + 1 < H && groups[i + W] >= 0 ? (y + 1) * squash - heights[i + W] : (y + 1) * squash;
    return [top, Math.max(top + 1, next)];
  };

  let count = 0;
  for (const g of groups) if (g >= count) count = g + 1;
  const tops = new Array<number>(count).fill(Infinity);
  const bottoms = new Array<number>(count).fill(-Infinity);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const g = groups[y * W + x];
      if (g < 0) continue;
      const [t, b] = span(x, y);
      tops[g] = Math.min(tops[g], Math.floor(t));
      bottoms[g] = Math.max(bottoms[g], Math.ceil(b));
    }
  }
  const slices: Slice[] = tops.map((top, index) => ({
    index,
    top: Number.isFinite(top) ? top : 0,
    raster: createRaster(W, Number.isFinite(top) ? bottoms[index] - top : 0),
  }));

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const g = groups[y * W + x];
      if (g < 0) continue;
      const [t, b] = span(x, y);
      const t0 = Math.floor(t);
      const cliff = b - t > 2.5;
      const falling = falls?.[y * W + x] === 1;
      const pooled = pools?.[y * W + x] === 1;
      const [cr, cg, cb] = getPixel(ground, x, y);
      const slice = slices[g];
      for (let py = t0; py < Math.ceil(b); py++) {
        const k = py - t0;
        let c: RGB = [cr, cg, cb];
        if (cliff && k >= 1 && falling) {
          c = waterfallColor(x, py, k);
        } else if (cliff && k >= 1 && pooled && pool) {
          c = sampleRaster(pool, x, ((py - t) / (b - t)) * pool.height);
        } else if (cliff && k >= 1) {
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
