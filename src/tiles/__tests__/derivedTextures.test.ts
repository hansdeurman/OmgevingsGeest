import { describe, expect, it } from 'vitest';
import type { RGB } from '../../rendering/palette';
import { forestFloorFrom, sparseGrassFrom, wetSandFrom, withDerivedFuses } from '../derivedTextures';
import { getPixel, paintRaster, type Raster } from '../raster';

const SIZE = 64;
const solid = (rgb: RGB) => paintRaster(SIZE, SIZE, () => rgb);
const SAND: RGB = [240, 210, 150];
const GRASS: RGB = [120, 190, 60];
const sand = solid(SAND);
const grass = solid(GRASS);

const pixels = (r: Raster) =>
  Array.from({ length: r.width * r.height }, (_, i) => getPixel(r, i % r.width, Math.floor(i / r.width)));
const brightness = (r: Raster) => pixels(r).reduce((s, [a, b, c]) => s + a + b + c, 0) / (r.width * r.height);

describe('wetSandFrom', () => {
  const wet = wetSandFrom(sand);

  it('darkens the sand it is made from', () => {
    expect(brightness(wet)).toBeLessThan(brightness(sand) * 0.95);
  });

  it('stays mostly sand-coloured, with only a few puddles', () => {
    const sandy = pixels(wet).filter(([r, , b]) => r > b).length;
    expect(sandy / (SIZE * SIZE)).toBeGreaterThan(0.8);
  });
});

describe('sparseGrassFrom', () => {
  const sparse = sparseGrassFrom(sand, grass, 1);
  const grassShare = pixels(sparse).filter(([r, g]) => g > r).length / (SIZE * SIZE);

  it('covers roughly a third of the sand with grass', () => {
    expect(grassShare).toBeGreaterThan(0.12);
    expect(grassShare).toBeLessThan(0.5);
  });

  it('only uses colours between its two sources', () => {
    for (const [r] of pixels(sparse)) {
      expect(r).toBeGreaterThanOrEqual(GRASS[0] - 1);
      expect(r).toBeLessThanOrEqual(SAND[0] + 1);
    }
  });

  it('tiles seamlessly: wrapping edges jump no more than interior pixels', () => {
    const red = (x: number, y: number) => getPixel(sparse, x, y)[0];
    let seam = 0;
    let inner = 0;
    for (let i = 0; i < SIZE; i++) {
      seam += Math.abs(red(SIZE - 1, i) - red(0, i)) + Math.abs(red(i, SIZE - 1) - red(i, 0));
      inner += Math.abs(red(SIZE / 2 - 1, i) - red(SIZE / 2, i)) + Math.abs(red(i, SIZE / 2 - 1) - red(i, SIZE / 2));
    }
    expect(seam).toBeLessThan(inner * 1.6 + 1);
  });
});

describe('forestFloorFrom', () => {
  it('is a darker, shaded version of the grass', () => {
    expect(brightness(forestFloorFrom(grass, 1))).toBeLessThan(brightness(grass) * 0.8);
  });
});

describe('withDerivedFuses', () => {
  it('derives every missing fuse texture from the loaded bases', () => {
    const t = withDerivedFuses({ sand: [sand], grass: [grass] });
    expect(t.wetSand).toHaveLength(1);
    expect(t.sparseGrass).toHaveLength(1);
    expect(t.forestFloor).toHaveLength(1);
  });

  it('keeps fuse textures that were provided as files', () => {
    const own = solid([1, 2, 3]);
    expect(withDerivedFuses({ sand: [sand], wetSand: [own] }).wetSand).toEqual([own]);
  });

  it('derives nothing without its bases', () => {
    expect(withDerivedFuses({ sand: [sand] }).sparseGrass).toBeUndefined();
    expect(withDerivedFuses({}).forestFloor).toBeUndefined();
  });
});
