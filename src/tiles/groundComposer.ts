import { valueNoise2D } from '../math/noise';
import type { CoverField } from './coverField';
import type { GridFrame } from './geometry';
import { shadeGround } from './groundShader';
import { zeroAmounts } from './levels';
import type { GroundTextures } from './placeholderTextures';
import { createRaster, sampleVariants, setPixel, type Raster } from './raster';

/** Size of the patches in which one texture variant dominates, in hex radii. */
const VARIANT_PATCH = 2.5;

/**
 * Paint the whole map's ground as one continuous top-down image. Because it
 * is one image, identical neighbours join without seams and fuse zones run
 * freely across hex edges. Pixels off the map stay transparent.
 */
export function composeGround(
  terrain: CoverField,
  textures: GroundTextures,
  frame: GridFrame,
  size: number,
  seed: number,
): Raster {
  const out = createRaster(frame.width, frame.height);
  const a = zeroAmounts();
  const vScale = 1 / (VARIANT_PATCH * size);
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const lx = x + 0.5 - frame.ox;
      const ly = y + 0.5 - frame.oy;
      if (!terrain.inside(lx, ly)) continue;
      terrain.sample(lx, ly, a);
      const t = valueNoise2D(lx * vScale, ly * vScale, seed + 101);
      setPixel(out, x, y, shadeGround(a, (kind) => sampleVariants(textures[kind], x, y, t)));
    }
  }
  return out;
}
