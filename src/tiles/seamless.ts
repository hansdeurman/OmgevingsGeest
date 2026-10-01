import { smoothstep } from '../math/scalar';
import { createRaster, getPixel, setPixel, type Raster } from './raster';

/**
 * Near the left/right (or top/bottom) edges, cross-fade toward a copy shifted
 * by half the texture. The shifted copy's own seam lands in the centre, where
 * the fade is zero, so nothing new appears.
 */
function blendShifted(r: Raster, axis: 'x' | 'y', band: number): Raster {
  const out = createRaster(r.width, r.height);
  const n = axis === 'x' ? r.width : r.height;
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      const i = axis === 'x' ? x : y;
      const w = 1 - smoothstep(0, band * n, Math.min(i, n - 1 - i));
      const a = getPixel(r, x, y);
      const b = axis === 'x' ? getPixel(r, (x + r.width / 2) % r.width, y) : getPixel(r, x, (y + r.height / 2) % r.height);
      setPixel(out, x, y, [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w], a[3]);
    }
  }
  return out;
}

/**
 * Hide wrap-around seams in a texture that was meant to tile but doesn't
 * quite (typical for generated art). `band` is the share of each edge that
 * is blended. Width and height must be even.
 */
export function makeSeamless(r: Raster, band = 0.15): Raster {
  return blendShifted(blendShifted(r, 'x', band), 'y', band);
}
