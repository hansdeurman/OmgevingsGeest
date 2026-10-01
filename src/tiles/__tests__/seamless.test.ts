import { describe, expect, it } from 'vitest';
import { getPixel, paintRaster, type Raster } from '../raster';
import { makeSeamless } from '../seamless';

const SIZE = 40;
// A plain left-to-right ramp: smooth inside, a hard jump where it wraps.
const ramp = paintRaster(SIZE, SIZE, (x, y) => [x * 6, y * 6, 100]);

const jump = (r: Raster, ax: number, ay: number, bx: number, by: number) => {
  const a = getPixel(r, ax, ay);
  const b = getPixel(r, bx, by);
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
};
const worstSeam = (r: Raster) =>
  Math.max(...Array.from({ length: SIZE }, (_, i) => Math.max(jump(r, SIZE - 1, i, 0, i), jump(r, i, SIZE - 1, i, 0))));

describe('makeSeamless', () => {
  const fixed = makeSeamless(ramp, 0.25);

  it('removes the jump where the texture wraps', () => {
    expect(worstSeam(ramp)).toBeGreaterThan(200);
    expect(worstSeam(fixed)).toBeLessThan(20);
  });

  it('leaves the centre untouched', () => {
    expect(getPixel(fixed, SIZE / 2, SIZE / 2)).toEqual(getPixel(ramp, SIZE / 2, SIZE / 2));
  });

  it('keeps size and opacity', () => {
    expect([fixed.width, fixed.height]).toEqual([SIZE, SIZE]);
    expect(getPixel(fixed, 0, 0)[3]).toBe(255);
  });
});
