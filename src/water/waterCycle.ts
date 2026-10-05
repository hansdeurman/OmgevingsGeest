import { airStep, createAir, DEFAULT_AIR, humidAir, type Air, type AirParams } from './atmosphere';
import type { Climate } from './climate';
import { restoreWorld, saveWorld, snapshot, stepHydro, type HydroSnapshot, type HydroWorld, type WorldState } from './hydroWorld';
import type { Model } from './waterRun';

/**
 * The water cycle on a map, run by its climate instead of a script: the
 * sea moistens the air, the wind carries it inland, the mountains force it
 * up so its vapour condenses into clouds that rain, or snow, on their
 * slopes; snow and glacier ice melt as it warms; the water soaks in, runs
 * off in rivers back to the sea, and what evaporates on the way rises into
 * the air again.
 */
export interface WaterCycle {
  world: HydroWorld;
  air: Air;
  climate: Climate;
  params: AirParams;
  /** Steps taken. */
  step: number;
  /** Scratch: how much weather systems lift the air, per hex. */
  lift: Float32Array;
}

/** The sky of one moment, for a view: clouds and what falls from them per hex, the wind, the season. */
export interface SkySnapshot {
  cloud: Float32Array;
  fall: Float32Array;
  wind: { x: number; y: number };
  warmth: number;
  yearShare: number;
}

export interface CycleSnapshot extends HydroSnapshot {
  sky: SkySnapshot;
}

export function createWaterCycle(world: HydroWorld, climate: Climate, params: AirParams = DEFAULT_AIR): WaterCycle {
  const { cols, rows, n } = world.topo;
  const sea = Uint8Array.from(world.sink, (s, i) => (s && world.ground[i] <= 0 ? 1 : 0));
  const air = createAir(cols, rows, world.ground, sea);
  humidAir(air, climate.at(0).warmth, params);
  return { world, air, climate, params, step: 0, lift: new Float32Array(n) };
}

/** One step, in place: the air moves and rains, then the ground's water takes it in, and what evaporates rises. */
export function cycleStep(c: WaterCycle): void {
  const { world, air, climate } = c;
  const { warmth, wind, evaporation } = climate.at(c.step);
  airStep(air, { warmth, wind, lift: climate.lift(c.step, world.topo.cols, world.topo.rows, c.lift) }, c.params);
  stepHydro(world, { rain: air.fall, warmth, evaporation, into: air.rise });
  c.step++;
}

export const skyOf = (c: WaterCycle): SkySnapshot => {
  const { wind, warmth, yearShare } = c.climate.at(c.step);
  return { cloud: c.air.cloud.slice(), fall: c.air.fall.slice(), wind, warmth, yearShare };
};

interface CycleState {
  world: WorldState;
  air: Float32Array[];
  step: number;
}

const airArrays = (a: Air) => [a.vapour, a.cloud, a.fall, a.rise];

/** The cycle as a model to run: steps follow on from where it is. */
export const cycleModel = (c: WaterCycle): Model<CycleState, CycleSnapshot> => ({
  step: () => cycleStep(c),
  save: () => ({ world: saveWorld(c.world), air: airArrays(c.air).map((a) => a.slice()), step: c.step }),
  restore(state) {
    restoreWorld(c.world, state.world);
    airArrays(c.air).forEach((a, k) => a.set(state.air[k]));
    c.step = state.step;
  },
  view: () => ({ ...snapshot(c.world), sky: skyOf(c) }),
});
