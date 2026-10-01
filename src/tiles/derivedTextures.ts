import { mix, type RGB } from '../rendering/palette';
import { hash2, tileableValueNoise2D } from '../math/noise';
import { smoothstep } from '../math/scalar';
import type { GroundTextures } from './placeholderTextures';
import { paintRaster, sampleRaster, type Raster } from './raster';

/**
 * Fuse textures computed from the approved base art, so every in-between
 * material matches its neighbours exactly. A fuse supplied as a file wins.
 */

const PUDDLE: RGB = [178, 214, 232];
const MOSS: RGB = [52, 104, 46];
const LEAVES: RGB[] = [[150, 98, 46], [186, 128, 52], [120, 84, 44]];

/** Seamless noise in [0, 1] over a raster of the given size. */
const tileNoise = (size: number, cells: number, seed: number) => (x: number, y: number) =>
  tileableValueNoise2D((x / size) * cells, (y / size) * cells, cells, seed);

/** Damp sand: darker and richer, with a few small, shallow sky-blue puddles. */
export function wetSandFrom(sand: Raster, seed = 0): Raster {
  const big = tileNoise(sand.width, 5, seed + 11);
  const fine = tileNoise(sand.width, 20, seed + 12);
  return paintRaster(sand.width, sand.height, (x, y) => {
    const [r, g, b] = sampleRaster(sand, x, y);
    const damp: RGB = [r * 0.87, g * 0.82, b * 0.76];
    const puddle = smoothstep(0.74, 0.78, big(x, y) * 0.7 + fine(x, y) * 0.3);
    return mix(damp, PUDDLE, puddle * 0.65);
  });
}

/** Sand with soft-edged patches of the real grass over roughly a third of it. */
export function sparseGrassFrom(sand: Raster, grass: Raster, seed = 0): Raster {
  const big = tileNoise(sand.width, 6, seed + 21);
  const fine = tileNoise(sand.width, 24, seed + 22);
  return paintRaster(sand.width, sand.height, (x, y) => {
    const cover = smoothstep(0.54, 0.6, big(x, y) * 0.6 + fine(x, y) * 0.4);
    return mix(sampleRaster(sand, x, y), sampleRaster(grass, x, y), cover);
  });
}

/** Grass in the shade of trees: darker, mossy patches, scattered fallen leaves. */
export function forestFloorFrom(grass: Raster, seed = 0): Raster {
  const moss = tileNoise(grass.width, 8, seed + 31);
  return paintRaster(grass.width, grass.height, (x, y) => {
    const leaf = hash2(x >> 1, y >> 1, seed + 32);
    if (leaf > 0.985) return LEAVES[Math.floor(hash2(y >> 1, x >> 1, seed + 33) * LEAVES.length)];
    const [r, g, b] = sampleRaster(grass, x, y);
    return mix([r * 0.6, g * 0.68, b * 0.66], MOSS, smoothstep(0.5, 0.8, moss(x, y)) * 0.45);
  });
}

export function withDerivedFuses(t: Partial<GroundTextures>): Partial<GroundTextures> {
  const out = { ...t };
  const { sand, grass } = t;
  if (sand && !t.wetSand) out.wetSand = sand.map((s, i) => wetSandFrom(s, i));
  if (sand && grass && !t.sparseGrass) out.sparseGrass = sand.map((s, i) => sparseGrassFrom(s, grass[i % grass.length], i));
  if (grass && !t.forestFloor) out.forestFloor = grass.map((g, i) => forestFloorFrom(g, i));
  return out;
}
