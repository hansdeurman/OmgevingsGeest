import { clamp, smoothstep } from '../math/scalar';

/**
 * How hexes hold on to water: rain first soaks into the ground (forest and
 * meadow hold much, sand little, bare rock high up almost nothing) and seeps
 * out again slowly, so streams keep running long after the rain; cold
 * precipitation lies as snow and melts when it warms, and glaciers on the
 * highest peaks melt slowly all summer. Heights and water in terrace steps.
 */

/** How a hex holds water: soil it can fill, how fast rain soaks in, and what share of its soil water seeps out per step. */
export interface Soak {
  capacity: number;
  infiltration: number;
  release: number;
}

/** Soak per hex, as flat arrays. */
export interface SoakMap {
  capacity: Float32Array;
  infiltration: Float32Array;
  release: Float32Array;
}

/** The weather over one step: rain (everywhere, or per hex), warmth (-1 winter … 1 summer) and how fast warm water evaporates. */
export interface Weather {
  rain: number | ArrayLike<number>;
  warmth: number;
  evaporation: number;
  /** Where evaporated water goes, added per hex (into the air); gone if absent. */
  into?: Float32Array;
}

/** Temperature (°, roughly) at sea level in spring, how far the seasons swing it, and how much colder each step up is. */
const TEMP = { base: 5, season: 6, lapse: 1.1 };
/** Snow melted per degree above freezing per step (steps of water). */
const MELT = 0.004;
/** Evaporation runs at its full rate at this temperature, slower when colder. */
const EVAPORATION_AT = 10;
/** Water this deep (steps) covers its whole hex; thinner water (a stream) covers a share of it, and evaporates that much slower. */
const OPEN_WATER = 0.3;
/** Ice (steps of water) glaciers hold, per step of height above where they start. */
const GLACIER = { from: 6.5, ice: 2.5 };

/** From grass and tree levels (0–4) and elevation: forest holds most and gives it back slowest, bare rock high up holds least. */
export function soakOf(grass: number, trees: number, elevation: number): Soak {
  const rock = smoothstep(4.5, 6.5, elevation);
  return {
    capacity: (0.15 + 0.1 * grass + 0.2 * trees) * (1 - 0.85 * rock),
    infiltration: (0.015 + 0.005 * grass + 0.01 * trees) * (1 - 0.7 * rock),
    release: 0.012 / (1 + 0.5 * trees),
  };
}

export function soakMap(soaks: readonly Soak[]): SoakMap {
  return {
    capacity: Float32Array.from(soaks, (s) => s.capacity),
    infiltration: Float32Array.from(soaks, (s) => s.infiltration),
    release: Float32Array.from(soaks, (s) => s.release),
  };
}

export const temperature = (elevation: number, warmth: number) => TEMP.base + TEMP.season * warmth - TEMP.lapse * elevation;

/** Ice a glacier holds on ground this high (none below where glaciers start). */
export const glacierOf = (elevation: number) => Math.max(0, elevation - GLACIER.from) * GLACIER.ice;

/** One step of weather on every hex, in place: precipitation, melt, soaking in and seeping out, evaporation. */
export function weatherStep(ground: Float32Array, depth: Float32Array, soil: Float32Array, snow: Float32Array, soak: SoakMap, weather: Weather): void {
  const { rain, warmth, evaporation, into } = weather;
  for (let i = 0; i < depth.length; i++) {
    const t = temperature(ground[i], warmth);
    const p = typeof rain === 'number' ? rain : rain[i];
    if (t < 0) snow[i] += p;
    else depth[i] += p;
    const melt = Math.min(snow[i], MELT * Math.max(0, t));
    snow[i] -= melt;
    const soaked = Math.max(0, Math.min(depth[i] + melt, soak.infiltration[i], soak.capacity[i] - soil[i]));
    const seep = t < 0 ? 0 : soil[i] * soak.release[i]; // frozen ground holds its water
    soil[i] += soaked - seep;
    const water = depth[i] + melt - soaked + seep;
    depth[i] = Math.max(0, water - evaporation * clamp(t / EVAPORATION_AT, 0, 1.5) * Math.min(1, water / OPEN_WATER));
    if (into) into[i] += Math.max(0, water - depth[i]);
  }
}
