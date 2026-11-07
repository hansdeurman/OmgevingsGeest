import { yearShare } from '../water/sun';
import { cycleModel, cycleStep, type CycleSnapshot, type CycleState, type WaterCycle } from '../water/waterCycle';
import type { Model } from '../water/waterRun';
import type { Creature } from './creature';
import { habitatOf } from './habitat';
import { countsOf, createLife, createWork, lifeModel, lifeStep, populate, release, type Life, type LifeState, type LifeWork } from './life';
import { touchWorld } from './worldTouch';

/**
 * A world and the life in it, stepped together: each step the water cycle
 * goes on, the creatures feel the world as it is now and live their step,
 * and their powers work on the world for the next. Creatures let in by the
 * player come in at the step they were sent for, so going back in time
 * and on again brings them in again, just as before.
 */
export interface Ecosystem {
  cycle: WaterCycle;
  life: Life;
  work: LifeWork;
  /** Creatures to let in, by the step they come in at. */
  releases: Map<number, Release[]>;
}

export interface Release {
  kind: number;
  count: number;
}

export function createEcosystem(cycle: WaterCycle, room: ArrayLike<number>, seed = 1, start = true): Ecosystem {
  const h = habitatOf(cycle);
  const life = createLife(h, room, seed);
  const work = createWork(life);
  if (start) populate(life, h, work);
  return { cycle, life, work, releases: new Map() };
}

/** Let creatures in at `step` (they come in as it begins). */
export function schedule(e: Ecosystem, step: number, r: Release): void {
  e.releases.set(step, [...(e.releases.get(step) ?? []), r]);
}

export function ecoStep(e: Ecosystem): void {
  const { cycle, life, work } = e;
  for (const r of e.releases.get(cycle.step) ?? []) release(life, habitatOf(cycle), r.kind, r.count, work);
  cycleStep(cycle);
  lifeStep(life, habitatOf(cycle), yearShare(cycle.step), work);
  touchWorld(cycle, work.influence);
}

/** What a view shows of a creature. */
export type CreatureView = Pick<Creature, 'id' | 'kind' | 'x' | 'y' | 'heading' | 'energy' | 'doing' | 'age'>;

export interface LifeSnapshot {
  creatures: CreatureView[];
  counts: Int32Array;
  plants: Float32Array;
}

export interface EcoSnapshot extends CycleSnapshot {
  life: LifeSnapshot;
}

const viewOf = ({ id, kind, x, y, heading, energy, doing, age }: Creature): CreatureView => ({ id, kind, x, y, heading, energy, doing, age });

export const lifeView = (life: Life): LifeSnapshot => ({ creatures: life.creatures.map(viewOf), counts: countsOf(life), plants: life.food.plants.slice() });

/** The world and its life as a model to run. */
export function ecoModel(e: Ecosystem): Model<{ world: CycleState; life: LifeState }, EcoSnapshot> {
  const [world, life] = [cycleModel(e.cycle), lifeModel(e.life)];
  return {
    step: () => ecoStep(e),
    save: () => ({ world: world.save(), life: life.save() }),
    restore(s) {
      world.restore(s.world);
      life.restore(s.life);
    },
    view: () => ({ ...world.view(), life: lifeView(e.life) }),
  };
}
