import { mix, type RGB } from '../rendering/palette';
import { clamp, smoothstep } from '../math/scalar';

/** RGBA pixel buffer, layout-compatible with canvas ImageData. */
export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function createRaster(width: number, height: number): Raster {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function setPixel(r: Raster, x: number, y: number, [red, g, b]: RGB, a = 255): void {
  const i = (y * r.width + x) * 4;
  r.data[i] = red;
  r.data[i + 1] = g;
  r.data[i + 2] = b;
  r.data[i + 3] = a;
}

export function getPixel(r: Raster, x: number, y: number): [number, number, number, number] {
  const i = (y * r.width + x) * 4;
  return [r.data[i], r.data[i + 1], r.data[i + 2], r.data[i + 3]];
}

export function paintRaster(width: number, height: number, paint: (x: number, y: number) => RGB): Raster {
  const r = createRaster(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) setPixel(r, x, y, paint(x, y));
  return r;
}

const wrap = (v: number, n: number) => ((Math.floor(v) % n) + n) % n;

/** Nearest-pixel lookup that tiles the raster infinitely. */
export function sampleRaster(r: Raster, x: number, y: number): RGB {
  const i = (wrap(y, r.height) * r.width + wrap(x, r.width)) * 4;
  return [r.data[i], r.data[i + 1], r.data[i + 2]];
}

/**
 * Pick between texture variants with a slowly varying selector `t` in [0, 1].
 * Variants hold steady over most of the range and cross-fade only near the
 * switch points, so the map shows distinct patches rather than a muddy mix.
 */
export function sampleVariants(variants: readonly Raster[], x: number, y: number, t: number): RGB {
  if (variants.length === 1) return sampleRaster(variants[0], x, y);
  const f = clamp(t, 0, 1) * (variants.length - 1);
  const i = Math.min(Math.floor(f), variants.length - 2);
  const k = smoothstep(0.35, 0.65, f - i);
  if (k <= 0) return sampleRaster(variants[i], x, y);
  if (k >= 1) return sampleRaster(variants[i + 1], x, y);
  return mix(sampleRaster(variants[i], x, y), sampleRaster(variants[i + 1], x, y), k);
}
