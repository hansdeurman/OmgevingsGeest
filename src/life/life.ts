import { random, rngOf, type Rng } from '../math/rng';
import { YEAR } from '../water/sun';
import type { Model } from '../water/waterRun';
import { appeal } from './appeal';
import { live, type Surroundings } from './behaviour';
import { BESTIARY } from './bestiary';
import { createCensus, takeCensus, type Census } from './census';
import { about, type Creature } from './creature';
import { createFood, growFood, type Food } from './food';
import { createFeel, feel, type Feel, type Habitat } from './habitat';
import { centreOf, hexAt } from './hexSpace';
import { answer, call, type Calling } from './manifest';
import { castPowers, createInfluence, mindsOf, type Influence } from './powers';

/**
 * All life on a map: its creatures, its plants and fish, and the world's
 * call for mystic creatures, stepped along with the world it lives in.
 * Chance comes from its own seeded RNG, kept with it, so a run goes back to
 * any moment and on again exactly as it went.
 */
export interface Life extends Calling {
  cols: number;
  rows: number;
  creatures: Creature[];
  food: Food;
  rng: Rng;
  nextId: number;
  /** The most of each kind there have been. */
  peaks: Int32Array;
}

/** What a step works out afresh from life and its world: kept between steps only to save making it again. */
export interface LifeWork {
  census: Census;
  feel: Feel;
  influence: Influence;
}

export const createLife = (h: Habitat, room: ArrayLike<number>, seed = 1): Life => ({
  cols: h.cols,
  rows: h.rows,
  creatures: [],
  food: createFood(room, h),
  rng: rngOf(seed * 7919 + 17),
  nextId: 1,
  calling: new Float32Array(BESTIARY.length),
  rest: new Float32Array(BESTIARY.length),
  peaks: new Int32Array(BESTIARY.length),
});

export const createWork = (life: Life): LifeWork => {
  const n = life.cols * life.rows;
  return { census: createCensus(life.cols, life.rows), feel: createFeel(n), influence: createInfluence(n) };
};

/** How many of each kind there are. */
export const countsOf = (life: Life) => {
  const counts = new Int32Array(BESTIARY.length);
  for (const c of life.creatures) counts[c.kind]++;
  return counts;
};

/** The creatures' surroundings this step: who is where, how each hex feels, the minds at work. */
function surroundingsOf(life: Life, h: Habitat, year: number, work: LifeWork): Surroundings {
  const present = life.creatures.filter(about);
  takeCensus(work.census, present);
  const counts = countsOf(life);
  counts.forEach((n, k) => (life.peaks[k] = Math.max(life.peaks[k], n)));
  const population = { counts, peaks: life.peaks };
  feel(h, life.food.plants, work.census.crowd, work.feel);
  const env: Surroundings = {
    h,
    feel: work.feel,
    food: life.food,
    census: work.census,
    creatures: present,
    rng: life.rng,
    year,
    minds: mindsOf(life.creatures, population),
    ...population,
    born: (kind, x, y, energy) => ({ id: life.nextId++, kind, x, y, heading: random(life.rng) * 2 * Math.PI, energy, age: 0, doing: 'roam', left: 0 }),
    settle: (kind) => spotFor(kind, env),
  };
  return env;
}

/** Hexes a newcomer looks at to settle on: the best of them for it. */
const LOOKS = 40;

/** A spot for a newcomer of `kind`: the most appealing of a few hexes picked at random, if it can be on any. */
function spotFor(kind: number, env: Surroundings): { x: number; y: number } | undefined {
  const s = BESTIARY[kind];
  let [best, most] = [-1, -Infinity];
  for (let k = 0; k < LOOKS; k++) {
    const i = Math.floor(random(env.rng) * env.h.cols * env.h.rows);
    const worth = appeal(s, env.h, env.feel, env.food, i, 0.5, env.census) + 0.1 * random(env.rng);
    if (worth > most) [best, most] = [i, worth];
  }
  return best >= 0 && most > -Infinity ? centreOf(env.h.cols, best) : undefined;
}

/** Let `count` creatures of `kind` into the world, a herd together, others each where it suits it; those let in. */
export function release(life: Life, h: Habitat, kind: number, count: number, work = createWork(life)): Creature[] {
  const env = surroundingsOf(life, h, 0, work);
  const s = BESTIARY[kind];
  const added: Creature[] = [];
  let spot = spotFor(kind, env);
  for (let k = 0; k < count && spot; k++) {
    const jitter = () => (random(life.rng) - 0.5) * 0.4;
    const c = { ...env.born(kind, spot.x + jitter(), spot.y + jitter(), 0.7), age: s.matures + Math.floor(random(life.rng) * s.matures), left: s.mystic ? s.lifespan : Math.floor(random(life.rng) * YEAR) };
    added.push(c);
    if (!s.herds) spot = spotFor(kind, env);
  }
  life.creatures.push(...added);
  return added;
}

/** Start every ordinary kind off, as many of each as it starts with. */
export function populate(life: Life, h: Habitat, work = createWork(life)): void {
  BESTIARY.forEach((s, kind) => s.start && release(life, h, kind, s.start, work));
}

/** Share of the most plants a hex grows that a creature (of size 1) gives back to it when it dies. */
const ROT = 0.1;

/** One step of all life on `h`, in place, `year` the share of the year since midwinter: its influence on the world is left in `work`. */
export function lifeStep(life: Life, h: Habitat, year: number, work: LifeWork): void {
  const env = surroundingsOf(life, h, year, work);
  const young: Creature[] = [];
  for (const c of [...life.creatures]) {
    if (c.energy <= 0) continue;
    if (BESTIARY[c.kind].mystic) answer(c, env);
    else young.push(...live(c, env));
  }
  castPowers(work.influence, life.creatures, h);
  growFood(life.food, h, work.influence.grow);
  const came = call(life, env);
  life.creatures = life.creatures.filter((c) => c.energy > 0 || rot(life, c));
  life.creatures.push(...young, ...came);
}

/** Give a dead creature back to the ground it lies on (mystic ones just fade): false, so it is taken out. */
function rot(life: Life, c: Creature): false {
  const s = BESTIARY[c.kind];
  if (s.mystic) return false;
  const i = hexAt(life.cols, life.rows, c.x, c.y);
  life.food.plants[i] = Math.min(life.food.room[i], life.food.plants[i] + ROT * s.size);
  return false;
}

export interface LifeState {
  creatures: Creature[];
  plants: Float32Array;
  fish: Float32Array;
  calling: Float32Array;
  rest: Float32Array;
  peaks: Int32Array;
  rng: number;
  nextId: number;
}

/** Keeping life's moments and going back to them. */
export const lifeModel = (life: Life): Pick<Model<LifeState, never>, 'save' | 'restore'> => ({
  save: () => ({
    creatures: life.creatures.map((c) => ({ ...c })),
    plants: life.food.plants.slice(),
    fish: life.food.fish.slice(),
    calling: life.calling.slice(),
    rest: life.rest.slice(),
    peaks: life.peaks.slice(),
    rng: life.rng.s,
    nextId: life.nextId,
  }),
  restore(s) {
    life.creatures = s.creatures.map((c) => ({ ...c }));
    life.food.plants.set(s.plants);
    life.food.fish.set(s.fish);
    life.calling.set(s.calling);
    life.rest.set(s.rest);
    life.peaks.set(s.peaks);
    [life.rng.s, life.nextId] = [s.rng, s.nextId];
  },
});
