import { describe, expect, it } from 'vitest';
import { GROUND_KINDS } from '../groundShader';
import { createPlaceholderTextures } from '../placeholderTextures';
import { getPixel, type Raster } from '../raster';

const SIZE = 64;
const textures = createPlaceholderTextures(SIZE);

const diff = (r: Raster, ax: number, ay: number, bx: number, by: number) => {
  const a = getPixel(r, ax, ay);
  const b = getPixel(r, bx, by);
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
};

/** Mean colour jump across a seam vs. across ordinary neighbouring pixels. */
function seamRatio(r: Raster): number {
  let seam = 0;
  let inner = 0;
  for (let i = 0; i < SIZE; i++) {
    seam += diff(r, SIZE - 1, i, 0, i) + diff(r, i, SIZE - 1, i, 0);
    inner += diff(r, SIZE / 2 - 1, i, SIZE / 2, i) + diff(r, i, SIZE / 2 - 1, i, SIZE / 2);
  }
  return seam / Math.max(inner, 1);
}

describe('createPlaceholderTextures', () => {
  it('provides at least two variants for every ground kind', () => {
    for (const kind of GROUND_KINDS) {
      expect(textures[kind].length).toBeGreaterThanOrEqual(2);
      for (const t of textures[kind]) expect([t.width, t.height]).toEqual([SIZE, SIZE]);
    }
  });

  it('tiles seamlessly: wrapping edges jump no more than interior pixels', () => {
    for (const kind of GROUND_KINDS) {
      for (const t of textures[kind]) expect(seamRatio(t)).toBeLessThan(1.6);
    }
  });

  it('makes variants of a kind actually differ', () => {
    for (const kind of GROUND_KINDS) {
      const [a, b] = textures[kind];
      expect(a.data).not.toEqual(b.data);
    }
  });
});
