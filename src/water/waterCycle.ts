import { smoothstep } from '../math/scalar';
import { airDemand, airStep, createAir, DEFAULT_AIR, humidAir, type Air, type AirParams, type Sky } from './atmosphere';
import { ALBEDO, createHeat, DEFAULT_HEAT, heatStep, type Heat, type HeatBudget, type HeatParams } from './heat';
import { restoreWorld, saveWorld, snapshot, stepHydro, totalWater, type HydroSnapshot, type HydroWorld, type WorldState } from './hydroWorld';
import { LAPSE } from './retention';
import { yearShare } from './sun';
import { createWind, DEFAULT_WIND, ROUGH, windStep, type Wind, type WindParams } from './wind';
import type { Model } from './waterRun';

/**
 * The water cycle on a map as one closed world, with the sun as the only
 * thing coming in from outside and heat radiated to space the only thing
 * going out. The sun warms land and sea, land faster; warm air rises and
 * the wind blows in under it, from the cool sea onto the warm land in
 * summer and off the cold land in winter. The sea, lakes, rivers, wet
 * soil and its plants give water to the air as much as it takes; the
 * wind carries it, mountains force it up, and where it cools it condenses
 * into clouds, warming the air, and falls as rain or snow, mostly on the
 * mountains. Snow and ice melt as it warms; the water soaks in, runs off
 * in rivers into the lakes and the sea, and evaporates again. No water is
 * made or lost: what leaves the land fills the sea, what evaporates from
 * the sea is drawn from it.
 */
export interface ClimateParams {
  heat: HeatParams;
  wind: WindParams;
  air: AirParams;
}

export const defaultClimate = (): ClimateParams => ({ heat: { ...DEFAULT_HEAT }, wind: { ...DEFAULT_WIND }, air: { ...DEFAULT_AIR } });

/** What a map's ground is, per hex: how bright it is bare, and how rough for the wind. Grass everywhere if not given. */
export interface GroundCover {
  albedo: ArrayLike<number>;
  rough: ArrayLike<number>;
}

export interface WaterCycle {
  world: HydroWorld;
  air: Air;
  heat: Heat;
  wind: Wind;
  params: ClimateParams;
  cover: GroundCover;
  /** For the eddies. */
  seed: number;
  /** Steps taken. */
  step: number;
  /** Water the sea holds, all its hexes together (steps). */
  sea: number;
  /** Per hex, worked out each step: the air's own temperature, cloud cover, the surface's brightness and heat it holds. */
  temperature: Float32Array;
  clouds: Float32Array;
  albedo: Float32Array;
  capacity: Float32Array;
  /** If set, heat that comes and goes is added to it. */
  budget?: HeatBudget;
}

export interface CycleOptions {
  cover?: GroundCover;
  params?: ClimateParams;
  seed?: number;
}

/** The sky of one moment, for a view: clouds, what falls, the wind, the air's and the surfaces' temperatures per hex, the time of year. */
export interface SkySnapshot {
  cloud: Float32Array;
  fall: Float32Array;
  windX: Float32Array;
  windY: Float32Array;
  temperature: Float32Array;
  surface: Float32Array;
  yearShare: number;
}

export interface CycleSnapshot extends HydroSnapshot {
  sky: SkySnapshot;
}

/** The sea's water at the start: so much that the land's water cycle hardly changes it, but counted all the same. */
const SEA_HOLDS = 1e4;
/** Sea-level temperature (°C) the world starts at, in spring, and its sea. */
const START = { air: 6, sea: 7 };
/** Lakes this deep cover their hex: it is water, not ground, to the sun. Water this much deeper holds as much heat as the sea. */
const LAKE = { from: 0.3, deep: 3 };
/** Cloud (steps) that covers a hex's sky fully. */
const OVERCAST = 0.08;

export function createWaterCycle(world: HydroWorld, options: CycleOptions = {}): WaterCycle {
  const { cols, rows, n } = world.topo;
  const sea = Uint8Array.from(world.sink, (s, i) => (s && world.ground[i] <= 0 ? 1 : 0));
  const cover = options.cover ?? { albedo: Float32Array.from(sea, (s) => (s ? ALBEDO.sea : ALBEDO.grass)), rough: Float32Array.from(sea, (s) => (s ? ROUGH.sea : ROUGH.land)) };
  const heat = createHeat(cols, rows, world.ground, START.air);
  sea.forEach((s, i) => s && (heat.surface[i] = START.sea));
  const air = createAir(cols, rows, world.ground, sea);
  const temperature = Float32Array.from(heat.air, (t, i) => t - LAPSE * heat.height[i]);
  humidAir(air, temperature);
  const array = () => new Float32Array(n);
  return { world, air, heat, wind: createWind(n), params: options.params ?? defaultClimate(), cover, seed: options.seed ?? 1, step: 0, sea: SEA_HOLDS, temperature, clouds: array(), albedo: array(), capacity: array() };
}

/** All the water in the world: on and in the ground, in the air, falling, and in the sea. It stays the same. */
export function cycleWater(c: WaterCycle): number {
  const { world, air } = c;
  return totalWater(world.depth) + totalWater(world.soil) + totalWater(world.snow) + totalWater(air.vapour) + totalWater(air.cloud) + totalWater(air.fall) + c.sea;
}

/** What each hex's surface is like now: sea (or sea ice), lake water (or ice), snow, or its bare ground, wetter soil holding more heat. */
function surfaceNow(c: WaterCycle): void {
  const { world, air, heat, cover, albedo, capacity } = c;
  const seaHolds = c.params.heat.seaMemory;
  for (let i = 0; i < albedo.length; i++) {
    const t = heat.surface[i];
    if (air.sea[i]) {
      [albedo[i], capacity[i]] = [t < -1.8 ? ALBEDO.ice : ALBEDO.sea, seaHolds];
      continue;
    }
    const lake = smoothstep(0, LAKE.from, world.depth[i]);
    const ground = cover.albedo[i] + (ALBEDO.snow - cover.albedo[i]) * smoothstep(0, 0.15, world.snow[i]);
    albedo[i] = ground + ((t < 0 ? ALBEDO.ice : ALBEDO.water) - ground) * lake;
    const fill = world.soil[i] / (world.soak.capacity[i] || 1);
    capacity[i] = 1 + 1.5 * fill + (seaHolds - 1) * lake * Math.min(1, world.depth[i] / LAKE.deep);
  }
}

/** One step of the world, in place. */
export function cycleStep(c: WaterCycle): void {
  const { world, air, heat, wind, params, temperature } = c;
  for (let i = 0; i < temperature.length; i++) temperature[i] = heat.air[i] - LAPSE * heat.height[i];
  const sky: Sky = { temperature, surface: heat.surface, windX: wind.x, windY: wind.y };
  airDemand(air, sky, params.air);
  c.sea += stepHydro(world, { rain: air.fall, warmth: 0, evaporation: 0, temperature, demand: air.demand, into: air.rise });
  c.sea -= airStep(air, sky, params.air);
  for (let i = 0; i < c.clouds.length; i++) c.clouds[i] = Math.min(1, air.cloud[i] / OVERCAST);
  surfaceNow(c);
  heatStep(heat, yearShare(c.step), c, { cloud: c.clouds, evaporated: air.evaporated, condensed: air.condensed, windX: wind.x, windY: wind.y }, params.heat, c.budget);
  windStep(heat.topo, wind, heat.air, c.cover.rough, params.wind, c.step, c.seed);
  c.step++;
}

export const skyOf = (c: WaterCycle): SkySnapshot => ({
  cloud: c.air.cloud.slice(),
  fall: c.air.fall.slice(),
  windX: c.wind.x.slice(),
  windY: c.wind.y.slice(),
  temperature: Float32Array.from(c.heat.air, (t, i) => t - LAPSE * c.heat.height[i]),
  surface: c.heat.surface.slice(),
  yearShare: yearShare(c.step),
});

interface CycleState {
  world: WorldState;
  arrays: Float32Array[];
  step: number;
  sea: number;
}

/** Everything else that changes as the cycle runs. */
const changing = (c: WaterCycle) => [c.air.vapour, c.air.cloud, c.air.fall, c.air.rise, c.heat.surface, c.heat.air, c.wind.x, c.wind.y];

/** The cycle as a model to run: steps follow on from where it is. */
export const cycleModel = (c: WaterCycle): Model<CycleState, CycleSnapshot> => ({
  step: () => cycleStep(c),
  save: () => ({ world: saveWorld(c.world), arrays: changing(c).map((a) => a.slice()), step: c.step, sea: c.sea }),
  restore(state) {
    restoreWorld(c.world, state.world);
    changing(c).forEach((a, k) => a.set(state.arrays[k]));
    [c.step, c.sea] = [state.step, state.sea];
  },
  view: () => ({ ...snapshot(c.world), sky: skyOf(c) }),
});
