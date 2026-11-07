import { smoothstep } from '../math/scalar';
import { sunlight, yearShare } from '../water/sun';
import type { WaterCycle } from '../water/waterCycle';
import { QUALITIES, type Quality } from './elements';
import { ring } from './hexSpace';

/**
 * The world as the creatures in it feel it. A habitat is what the map is
 * like now, per hex: its ground and water, its air and sky. From it each
 * hex gets its qualities, each 0–1 (sunny, wet, green, warm, cold, high,
 * stormy, windy, cloudy, and full of other minds), which every creature
 * weighs by what it is: a fire creature seeks warmth, a stone one heights.
 */
export interface Habitat {
  cols: number;
  rows: number;
  height: ArrayLike<number>;
  /** Standing and running water (steps). */
  depth: ArrayLike<number>;
  sea: ArrayLike<number>;
  /** How full the ground is of water, 0–1. */
  wet: ArrayLike<number>;
  snow: ArrayLike<number>;
  /** The air at the ground (°C). */
  temperature: ArrayLike<number>;
  /** Cloud cover, 0–1, and rain or snow falling (steps). */
  cloud: ArrayLike<number>;
  fall: ArrayLike<number>;
  windX: ArrayLike<number>;
  windY: ArrayLike<number>;
  /** Sunlight now, as a share of midsummer's. */
  sun: number;
}

export type Feel = Record<Quality, Float32Array>;

export const createFeel = (n: number): Feel => Object.fromEntries(QUALITIES.map((q) => [q, new Float32Array(n)])) as Feel;

/** Where qualities start and are full: rain (steps), wind (hex spacings per step), heights, °C, creatures near. */
const FULL = { storm: [0.01, 0.15], wind: [0.05, 0.45], high: [1.5, 7], warm: [-2, 22], cold: [4, -15], lake: [0, 0.3], minds: [0, 8] } as const;
const ramp = (range: readonly [number, number], x: number) => smoothstep(range[0], range[1], x);

/** Every hex's qualities, from the habitat, the plants (0–1 of the most a hex grows) and how many creatures are on each hex. */
export function feel(h: Habitat, plants: ArrayLike<number>, crowd: ArrayLike<number>, out: Feel): void {
  const near = ring(h.cols, h.rows);
  for (let i = 0; i < out.sun.length; i++) {
    const t = h.temperature[i];
    out.sun[i] = h.sun * (1 - h.cloud[i]);
    out.wet[i] = h.sea[i] ? 1 : Math.max(ramp(FULL.lake, h.depth[i]), h.wet[i]);
    out.green[i] = plants[i];
    out.warm[i] = ramp(FULL.warm, t);
    out.cold[i] = ramp(FULL.cold, t);
    out.high[i] = ramp(FULL.high, h.height[i]);
    out.storm[i] = ramp(FULL.storm, h.fall[i]);
    out.wind[i] = ramp(FULL.wind, Math.hypot(h.windX[i], h.windY[i]));
    out.cloud[i] = h.cloud[i];
    let minds = crowd[i];
    for (let d = 0; d < 6; d++) minds += near[6 * i + d] >= 0 ? crowd[near[6 * i + d]] : 0;
    out.minds[i] = ramp(FULL.minds, minds);
  }
}

const wetness = new WeakMap<WaterCycle, Float32Array>();

/** A water cycle's world as a habitat: it reads the cycle's own arrays, as they are now. */
export function habitatOf(c: WaterCycle): Habitat {
  const { world, air, wind, params } = c;
  const { cols, rows, n } = world.topo;
  const wet = wetness.get(c) ?? new Float32Array(n);
  wetness.set(c, wet);
  for (let i = 0; i < n; i++) wet[i] = Math.min(1, world.soil[i] / (world.soak.capacity[i] || 1));
  const { sun, tilt } = params.heat;
  return {
    cols,
    rows,
    height: world.ground,
    depth: world.depth,
    sea: air.sea,
    wet,
    snow: world.snow,
    temperature: c.temperature,
    cloud: c.clouds,
    fall: air.fall,
    windX: wind.x,
    windY: wind.y,
    sun: sunlight(yearShare(c.step), params.heat) / (sun * (1 + tilt)),
  };
}
