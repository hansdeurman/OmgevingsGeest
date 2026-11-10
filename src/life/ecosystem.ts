import { avatarGuest, copyAvatar, createAvatar, stepAvatar, type Avatar, type Form, type Gift } from '../player/avatar';
import { yearShare } from '../water/sun';
import { cycleModel, cycleStep, type CycleSnapshot, type CycleState, type WaterCycle } from '../water/waterCycle';
import type { Model } from '../water/waterRun';
import type { Creature } from './creature';
import { habitatOf } from './habitat';
import { centreOf } from './hexSpace';
import { countsOf, createLife, createWork, lifeModel, lifeStep, populate, release, type Life, type LifeState, type LifeWork } from './life';
import { touchWorld } from './worldTouch';

/**
 * A world, the life in it and the player's avatar, stepped together: each
 * step the water cycle goes on, the avatar walks on, the creatures feel the
 * world as it is now and live their step, and their powers and the
 * avatar's gift work on the world for the next. What the player does comes
 * in as commands, each at the step it was given for, so going back in time
 * and on again does it all again, just as before.
 */
export interface Ecosystem {
  cycle: WaterCycle;
  life: Life;
  work: LifeWork;
  avatar: Avatar;
  /** What the player does, by the step it is done at. */
  commands: Map<number, Command[]>;
}

/** Something the player does: let creatures in, send the avatar somewhere, work a gift (or stop), take another form. */
export type Command = { do: 'release'; kind: number; count: number } | { do: 'go'; x: number; y: number } | { do: 'gift'; gift: Gift | null } | { do: 'form'; form: Form };

export function createEcosystem(cycle: WaterCycle, room: ArrayLike<number>, seed = 1, start = true): Ecosystem {
  const h = habitatOf(cycle);
  const life = createLife(h, room, seed);
  const work = createWork(life);
  if (start) populate(life, h, work);
  const { x, y } = centreOf(h.cols, Math.floor(h.rows / 2) * h.cols + Math.floor(h.cols / 2));
  return { cycle, life, work, avatar: createAvatar(x, y), commands: new Map() };
}

/** Give a command for `step` (it is done as that step begins). */
export function command(e: Ecosystem, step: number, c: Command): void {
  e.commands.set(step, [...(e.commands.get(step) ?? []), c]);
}

/** Forget the commands given for after `step`: what comes after it is to be played anew. */
export function forgetCommands(e: Ecosystem, step: number): void {
  for (const at of [...e.commands.keys()]) if (at > step) e.commands.delete(at);
}

const OBEY: { [K in Command['do']]: (e: Ecosystem, c: Extract<Command, { do: K }>) => void } = {
  release: (e, c) => release(e.life, habitatOf(e.cycle), c.kind, c.count, e.work),
  go: (e, c) => (e.avatar.target = { x: c.x, y: c.y }),
  gift: (e, c) => (e.avatar.gift = c.gift && e.avatar.spirit > 0 ? c.gift : null),
  form: (e, c) => (e.avatar.form = c.form),
};

const obey = (e: Ecosystem, c: Command) => (OBEY[c.do] as (e: Ecosystem, c: Command) => void)(e, c);

export function ecoStep(e: Ecosystem): void {
  const { cycle, life, work, avatar } = e;
  for (const c of e.commands.get(cycle.step) ?? []) obey(e, c);
  cycleStep(cycle);
  stepAvatar(avatar, life.cols, life.rows);
  lifeStep(life, habitatOf(cycle), yearShare(cycle.step), work, [avatarGuest(avatar)]);
  touchWorld(cycle, work.influence);
}

/** What a view shows of a creature. */
export type CreatureView = Pick<Creature, 'id' | 'kind' | 'x' | 'y' | 'heading' | 'energy' | 'doing' | 'age'>;

export interface LifeSnapshot {
  creatures: CreatureView[];
  counts: Int32Array;
  plants: Float32Array;
  /** The most plants each hex grows now. */
  room: Float32Array;
  /** Per kind: how loud the world calls for it (mystic kinds), in steps of full need. */
  calling: Float32Array;
}

export interface EcoSnapshot extends CycleSnapshot {
  life: LifeSnapshot;
  avatar: Avatar;
}

const viewOf = ({ id, kind, x, y, heading, energy, doing, age }: Creature): CreatureView => ({ id, kind, x, y, heading, energy, doing, age });

export const lifeView = (life: Life): LifeSnapshot => ({ creatures: life.creatures.map(viewOf), counts: countsOf(life), plants: life.food.plants.slice(), room: life.food.room.slice(), calling: life.calling.slice() });

/** The world, its life and the avatar as a model to run. */
export function ecoModel(e: Ecosystem): Model<{ world: CycleState; life: LifeState; avatar: Avatar }, EcoSnapshot> {
  const [world, life] = [cycleModel(e.cycle), lifeModel(e.life)];
  return {
    step: () => ecoStep(e),
    save: () => ({ world: world.save(), life: life.save(), avatar: copyAvatar(e.avatar) }),
    restore(s) {
      world.restore(s.world);
      life.restore(s.life);
      e.avatar = copyAvatar(s.avatar);
    },
    view: () => ({ ...world.view(), life: lifeView(e.life), avatar: copyAvatar(e.avatar) }),
  };
}
