import { tileableValueNoise2D } from '../math/noise';
import { smoothstep } from '../math/scalar';
import { gradient, mix } from './airGrid';
import type { HexTopology } from './hexTopology';

/**
 * The wind, from the heat. Warm air rises and leaves low pressure under it,
 * cool air sinks into high pressure, and the wind blows from high toward
 * low: in summer from the cool sea onto the warm land and up its sunny
 * slopes, in winter off the cold land. The ground slows it (the sea least,
 * forest and mountains most), the world's spin turns it to the right, and
 * where friction and spin balance the pushing it settles, crossing the
 * isobars at an angle (the Ekman balance). Eddies, highs and lows that
 * come and go and drift across the map, stir it, adding no pressure
 * overall: they move air and water about, they bring none in.
 * Wind in hex spacings per step, x east, y south.
 */
export interface Wind {
  x: Float32Array;
  y: Float32Array;
  /** The pressure the wind blows down (warmth below the map's mean, in degrees; eddies on top). */
  pressure: Float32Array;
  gx: Float32Array;
  gy: Float32Array;
  work: Float32Array;
}

export interface WindParams {
  /** Wind (hex spacings per step) for each degree per hex spacing of pressure difference, on ground of roughness 1. */
  push: number;
  /** How rough the ground is, overall. */
  friction: number;
  /** How hard the world's spin turns the wind (0: not at all, at the equator). */
  turning: number;
  /** How strong eddies are (degrees of pressure). */
  eddies: number;
}

export const DEFAULT_WIND: WindParams = { push: 0.5, friction: 1, turning: 0.35, eddies: 1.5 };

/** How rough each kind of ground is. */
export const ROUGH = { sea: 0.7, land: 1, forest: 1.6, mountain: 2 };
/** How rough a hex's ground is for the wind, from its tree level (0–4) and height. */
export const roughnessOf = (trees: number, elevation: number) => Math.max(ROUGH.land + ((ROUGH.forest - ROUGH.land) * trees) / 4, ROUGH.land + (ROUGH.mountain - ROUGH.land) * smoothstep(3, 6, elevation));

/** The wind never blows harder than this. */
export const MOST_WIND = 0.6;
/** Share of the way to its balance the wind goes per step. */
const FOLLOW = 0.4;
/** Pressure is smoothed this much: it is a broad thing, no hex has its own. */
const BROAD = 0.5;
/** Rounds of smoothing the wind gets. */
const SMOOTH = 2;
/** Eddies: their size and drift (hex spacings, per step), and over how many steps one forms and fades. */
const EDDY = { size: 7, drift: 0.05, life: 160 };

export const createWind = (n: number): Wind => ({
  x: new Float32Array(n),
  y: new Float32Array(n),
  pressure: new Float32Array(n),
  gx: new Float32Array(n),
  gy: new Float32Array(n),
  work: new Float32Array(n),
});

/** One step of wind over `air` (sea-level temperatures) and ground of `rough`ness per hex, in place. */
export function windStep(topo: HexTopology, w: Wind, air: ArrayLike<number>, rough: ArrayLike<number>, p: WindParams, step: number, seed: number): void {
  const { n, cols, rows } = topo;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += air[i];
  mean /= n;
  let eddyMean = 0;
  const size = { w: cols, h: (rows * Math.sqrt(3)) / 2 };
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const e = p.eddies ? p.eddies * eddyField(i - row * cols + (row & 1) / 2, (row * Math.sqrt(3)) / 2, size, step, seed) : 0;
    w.pressure[i] = mean - air[i] + e;
    eddyMean += e;
  }
  eddyMean /= n;
  for (let i = 0; i < n; i++) w.pressure[i] -= eddyMean;
  mix(topo, w.pressure, BROAD, w.work);
  gradient(topo, w.pressure, w.gx, w.gy);
  // The balance wind, in place of the slope.
  for (let i = 0; i < n; i++) {
    const [fx, fy] = [-p.push * w.gx[i], -p.push * w.gy[i]];
    const r = rough[i] * p.friction;
    const f = p.turning;
    const d = r * r + f * f || 1;
    [w.gx[i], w.gy[i]] = [(r * fx - f * fy) / d, (r * fy + f * fx) / d];
  }
  // A layer of air does not stop or start at one hex's edge: where the ground turns rough the wind slows over some way.
  for (let k = 0; k < SMOOTH; k++) {
    mix(topo, w.gx, 1, w.work);
    mix(topo, w.gy, 1, w.work);
  }
  for (let i = 0; i < n; i++) {
    let [x, y] = [w.gx[i], w.gy[i]];
    const speed = Math.hypot(x, y);
    if (speed > MOST_WIND) [x, y] = [(x * MOST_WIND) / speed, (y * MOST_WIND) / speed];
    w.x[i] += (x - w.x[i]) * FOLLOW;
    w.y[i] += (y - w.y[i]) * FOLLOW;
  }
}

/**
 * Eddies' pressure at map position (x, y) at `step`, on a map `size` hex
 * spacings: drifting highs and lows, each generation forming and fading over
 * two EDDY.life periods, two overlapping at a time so there always are some.
 * They wrap around the map's edges as the sky does, so there is no seam.
 */
function eddyField(x: number, y: number, size: { w: number; h: number }, step: number, seed: number): number {
  const age = step / EDDY.life;
  const k = Math.floor(age);
  const phase = age - k;
  const across = Math.max(2, Math.round(Math.max(size.w, size.h) / EDDY.size));
  const generation = (g: number) => {
    const angle = g * 2.4 + seed;
    const u = ((x - Math.cos(angle) * EDDY.drift * step) / size.w) * across;
    const v = ((y - Math.sin(angle) * EDDY.drift * step) / size.h) * across;
    const s = seed * 31 + g * 7;
    return (tileableValueNoise2D(u, v, across, s) + 0.5 * tileableValueNoise2D(2 * u, 2 * v, 2 * across, s + 1)) / 1.5 - 0.5;
  };
  return 2 * (generation(k) * Math.cos((Math.PI / 2) * phase) + generation(k + 1) * Math.sin((Math.PI / 2) * phase));
}
