/**
 * Hash-based value noise + fBm. No lookup tables, fully deterministic from seed.
 */

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function valueNoise2D(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const v00 = hash2(xi, yi, seed);
  const v10 = hash2(xi + 1, yi, seed);
  const v01 = hash2(xi, yi + 1, seed);
  const v11 = hash2(xi + 1, yi + 1, seed);
  const u = smootherstep(xf);
  const v = smootherstep(yf);
  return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v);
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
