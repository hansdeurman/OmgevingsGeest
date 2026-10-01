import { describe, expect, it } from 'vitest';
import type { RGB } from '../../rendering/palette';
import { getPixel, paintRaster, sampleRaster, sampleVariants } from '../raster';

const solid = (rgb: RGB) => paintRaster(4, 4, () => rgb);

describe('raster', () => {
  const r = paintRaster(4, 2, (x, y) => [x, y, 7]);

  it('paints opaque pixels', () => {
    expect(getPixel(r, 3, 1)).toEqual([3, 1, 7, 255]);
  });

  it('wraps when sampling outside its bounds', () => {
    expect(sampleRaster(r, 5, -1)).toEqual([1, 1, 7]);
    expect(sampleRaster(r, 4.7, 2.2)).toEqual([0, 0, 7]);
  });
});

describe('sampleVariants', () => {
  const red = solid([200, 0, 0]);
  const blue = solid([0, 0, 200]);

  it('uses the only variant when there is one', () => {
    expect(sampleVariants([red], 0, 0, 0.9)).toEqual([200, 0, 0]);
  });

  it('picks the first or last variant at the ends of the selector', () => {
    expect(sampleVariants([red, blue], 0, 0, 0)).toEqual([200, 0, 0]);
    expect(sampleVariants([red, blue], 0, 0, 1)).toEqual([0, 0, 200]);
  });

  it('cross-fades only in a narrow band between variants', () => {
    expect(sampleVariants([red, blue], 0, 0, 0.3)).toEqual([200, 0, 0]);
    const mid = sampleVariants([red, blue], 0, 0, 0.5);
    expect(mid[0]).toBeCloseTo(100, 6);
    expect(mid[2]).toBeCloseTo(100, 6);
  });
});
