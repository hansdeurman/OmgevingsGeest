/**
 * Hash-based value noise + fBm. No lookup tables, fully deterministic from seed.
 */

import { lerp } from './scalar';

/** Deterministic hash of an integer pair to [0, 1]. */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function valueNoise2D(x: number, y: number, seed: number): number {
  return latticeNoise(x, y, seed, (i) => i);
}

/**
 * Value noise that repeats every `period` units on both axes, for seamless
 * textures. `period` must be a positive integer.
 */
export function tileableValueNoise2D(x: number, y: number, period: number, seed: number): number {
  return latticeNoise(x, y, seed, (i) => ((i % period) + period) % period);
}

function latticeNoise(x: number, y: number, seed: number, wrap: (i: number) => number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = smootherstep(x - xi);
  const v = smootherstep(y - yi);
  const x0 = wrap(xi);
  const x1 = wrap(xi + 1);
  const y0 = wrap(yi);
  const y1 = wrap(yi + 1);
  return lerp(
    lerp(hash2(x0, y0, seed), hash2(x1, y0, seed), u),
    lerp(hash2(x0, y1, seed), hash2(x1, y1, seed), u),
    v,
  );
}

export interface FbmOptions {
  seed: number;
  octaves: number;
  persistence: number;
  lacunarity: number;
}

/** Returns a value in [0, 1]. */
export function fbm2D(x: number, y: number, opts: FbmOptions): number {
  let total = 0;
  let amp = 1;
  let freq = 1;
  let max = 0;
  for (let i = 0; i < opts.octaves; i++) {
    total += valueNoise2D(x * freq, y * freq, opts.seed + i * 1013) * amp;
    max += amp;
    amp *= opts.persistence;
    freq *= opts.lacunarity;
  }
  return total / max;
}
