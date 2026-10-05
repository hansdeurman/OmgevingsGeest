import { valueNoise2D } from '../math/noise';
import { clamp, piecewise, smoothstep } from '../math/scalar';
import { mix, type RGB } from '../rendering/palette';
import { MAX_ELEVATION } from './levels';
import { sampleRaster, type Raster } from './raster';
import { HIGH_LAKE_FROM } from './shores';

/**
 * How a lake's water looks, from what the simulation knows about it: its
 * temperature picks (and blends) painted textures from ice to warm algae
 * water, and the wind raises crests across it.
 */

/** Painted water, coldest first; temperatures are spread evenly over them. */
export const WATER_KINDS = ['ice', 'cold', 'mild', 'warm'] as const;
export type WaterKind = (typeof WATER_KINDS)[number];
export type WaterTextures = Record<WaterKind, Raster>;

const FOAM: RGB = [236, 246, 250];

/**
 * Weight of each water texture at temperature `t` (0 frozen … 1 warm): one
 * look holds over most of its range and only neighbours cross-fade, so a
 * small change in temperature shows without turning the water muddy.
 */
export function waterWeights(t: number): number[] {
  const f = clamp(t, 0, 1) * (WATER_KINDS.length - 1);
  const i = Math.min(Math.floor(f), WATER_KINDS.length - 2);
  const k = smoothstep(0.3, 0.7, f - i);
  return WATER_KINDS.map((_, j) => (j === i ? 1 - k : j === i + 1 ? k : 0));
}

/** A lake's temperature: mild on the foothills, cold high up, shifted by the season's `warmth` (-1 winter … 1 summer). */
export function lakeTemperature(level: number, warmth: number): number {
  const height = smoothstep(HIGH_LAKE_FROM, MAX_ELEVATION - 1, level);
  return clamp(0.72 - 0.42 * height + 0.45 * warmth, 0, 1);
}

/** How warm a lake looks (0 frozen … 1 warm) with its water this warm (°C): frozen below about freezing, warm from the high teens. */
export const lakeLook = piecewise([
  [-2, 0],
  [0.5, 0.3],
  [6, 0.6],
  [17, 1],
]);

/** Wind over the water: `strength` 0 (calm) … 1 (storm), `direction` it blows toward in radians, top-down. */
export interface Wind {
  strength: number;
  direction: number;
}

/**
 * Brightness (0..1) of a wave crest at frame pixel (x, y), for hexes `size`
 * px wide: short whitecaps lined up across the wind, closer together, longer
 * and in more patches the harder it blows.
 */
export function waveCrest(x: number, y: number, wind: Wind, size: number): number {
  if (wind.strength <= 0) return 0;
  const s = clamp(wind.strength, 0, 1);
  const [cx, cy] = [Math.cos(wind.direction), Math.sin(wind.direction)];
  const [along, across] = [x * cx + y * cy, y * cx - x * cy];
  const wobble = 1.2 * valueNoise2D(x / (0.6 * size), y / (0.6 * size), 71);
  const crest = smoothstep(0.9 - 0.2 * s, 1, Math.sin(2 * Math.PI * (along / (size * (0.34 - 0.14 * s)) + wobble)));
  const dash = smoothstep(0.55 - 0.2 * s, 0.75 - 0.15 * s, valueNoise2D(across / (0.22 * size), along / (0.5 * size), 73));
  const patch = smoothstep(0.6 - 0.4 * s, 0.85 - 0.2 * s, valueNoise2D(x / (1.3 * size), y / (1.3 * size), 72));
  return crest * dash * patch * s;
}

/** The water at frame pixel (x, y): textures mixed by `weights` (from waterWeights), lit by a wave `crest`; ice does not move. */
export function waterColour(textures: WaterTextures, x: number, y: number, weights: readonly number[], crest: number): RGB {
  const c: RGB = [0, 0, 0];
  WATER_KINDS.forEach((kind, j) => {
    if (!weights[j]) return;
    const s = sampleRaster(textures[kind], x, y);
    for (let k = 0; k < 3; k++) c[k] += s[k] * weights[j];
  });
  return mix(c, FOAM, 0.6 * crest * (1 - weights[0]));
}
