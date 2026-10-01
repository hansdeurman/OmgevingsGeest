import { mix, shade, type RGB } from '../rendering/palette';
import { hash2, tileableValueNoise2D } from '../math/noise';
import { smoothstep } from '../math/scalar';
import type { GroundKind } from './groundShader';
import { paintRaster, type Raster } from './raster';

/** Seamless square textures per ground kind; several variants each. */
export type GroundTextures = Record<GroundKind, Raster[]>;

type Painter = (u: number, v: number) => RGB;
type Noise = (u: number, v: number, cells: number) => number;

/**
 * Procedural stand-ins for the real ground art. Every painter only uses
 * noise that repeats over the texture, so all textures tile seamlessly.
 */
export function createPlaceholderTextures(size = 128): GroundTextures {
  const noise = (seed: number): Noise => (u, v, cells) =>
    tileableValueNoise2D((u / size) * cells, (v / size) * cells, cells, seed);

  const sand = (seed: number, base: RGB): Painter => {
    const n = noise(seed);
    return (u, v) => {
      const ripple = Math.sin(2 * Math.PI * ((v / size) * 9 + n(u, v, 4) * 1.6));
      const speck = hash2(u, v, seed) > 0.985 ? 0.9 : 1;
      return shade(base, (1 + 0.035 * ripple + (n(u, v, 16) - 0.5) * 0.1) * speck);
    };
  };

  const sparseGrass = (seed: number, base: RGB): Painter => {
    const n = noise(seed + 50);
    const ground = sand(seed, base);
    return (u, v) => {
      const blot = n(u, v, 8) * 0.55 + n(u, v, 32) * 0.45;
      return mix(ground(u, v), shade([138, 192, 80], 0.9 + n(u, v, 32) * 0.2), smoothstep(0.56, 0.64, blot));
    };
  };

  const grass = (seed: number, base: RGB): Painter => {
    const n = noise(seed);
    const flowers: RGB[] = [[255, 255, 255], [255, 222, 70], [242, 98, 84]];
    return (u, v) => {
      const flower = hash2(u >> 1, v >> 1, seed);
      if (flower > 0.996) return flowers[Math.floor(hash2(v >> 1, u >> 1, seed) * 3)];
      const patch = mix(shade(base, 0.85), shade(base, 1.15), n(u, v, 6));
      return shade(patch, 0.94 + n(u, v, 32) * 0.12);
    };
  };

  const forestFloor = (seed: number, base: RGB): Painter => {
    const n = noise(seed);
    return (u, v) => {
      if (hash2(u >> 1, v >> 1, seed) > 0.99) return [134, 100, 54];
      return shade(mix(shade(base, 0.72), base, n(u, v, 8)), 0.93 + n(u, v, 32) * 0.14);
    };
  };

  const water = (seed: number, base: RGB): Painter => {
    const n = noise(seed);
    return (u, v) => {
      const ridge = (1 - Math.abs(2 * n(u, v, 6) - 1)) ** 8;
      return mix(shade(base, 0.95 + n(u, v, 3) * 0.1), [190, 236, 252], ridge * 0.6);
    };
  };

  const paint = (p: Painter) => paintRaster(size, size, p);
  return {
    sand: [paint(sand(1, [242, 214, 158])), paint(sand(2, [236, 204, 148]))],
    wetSand: [paint(sand(3, [210, 182, 134])), paint(sand(4, [202, 176, 132]))],
    sparseGrass: [paint(sparseGrass(5, [242, 214, 158])), paint(sparseGrass(6, [236, 204, 148]))],
    grass: [paint(grass(7, [120, 194, 72])), paint(grass(8, [108, 184, 70]))],
    forestFloor: [paint(forestFloor(9, [76, 136, 58])), paint(forestFloor(10, [68, 126, 56]))],
    water: [paint(water(11, [72, 184, 228])), paint(water(12, [64, 174, 222]))],
  };
}
