import { rngOf } from '../../math/rng';
import type { Mind, Surroundings } from '../behaviour';
import { BESTIARY, kindOf } from '../bestiary';
import { createCensus, takeCensus } from '../census';
import type { Creature } from '../creature';
import { createFood, type Food } from '../food';
import { createFeel, feel, type Feel, type Habitat } from '../habitat';
import { centreOf } from '../hexSpace';

/** A mild, moist meadow `cols` × `rows`, in sunshine, still air; `change` sets any hex's fields. */
export function meadow(cols: number, rows: number, change: (i: number) => Partial<Record<keyof Habitat, number>> = () => ({})): Habitat {
  const n = cols * rows;
  const field = (key: keyof Habitat, base: number) => Float32Array.from({ length: n }, (_, i) => (change(i)[key] as number | undefined) ?? base);
  return {
    cols,
    rows,
    height: field('height', 1),
    depth: field('depth', 0),
    sea: field('sea', 0),
    wet: field('wet', 0.6),
    snow: field('snow', 0),
    temperature: field('temperature', 15),
    cloud: field('cloud', 0),
    fall: field('fall', 0),
    windX: field('windX', 0),
    windY: field('windY', 0),
    sun: 1,
  };
}

/** The habitat's food, every hex as green as `plants` (or per hex), and how it feels. */
export function sensed(h: Habitat, plants: number | ((i: number) => number) = 0.8, crowd?: ArrayLike<number>): { food: Food; feel: Feel } {
  const n = h.cols * h.rows;
  const food = createFood(new Float32Array(n).fill(1), h);
  food.plants.forEach((_, i) => (food.plants[i] = typeof plants === 'number' ? plants : plants(i)));
  const f = createFeel(n);
  feel(h, food.plants, crowd ?? new Float32Array(n), f);
  return { food, feel: f };
}

export const spot = (cols: number, i: number) => centreOf(cols, i);

/** A creature of kind `id` at hex `i`'s centre (or at x, y), half fed and grown, facing east. */
export function creature(id: string, cols: number, i: number, change: Partial<Creature> = {}): Creature {
  return { id: nextId++, kind: kindOf(id), ...centreOf(cols, i), heading: 0, energy: 0.5, age: 1000, doing: 'roam', left: 1000, ...change };
}
let nextId = 1;

/** What creatures on `h` sense of it and of each other, as a step of life would set it up. */
export function surroundings(h: Habitat, creatures: Creature[], options: { plants?: number | ((i: number) => number); year?: number; minds?: Mind[]; seed?: number; peaks?: ArrayLike<number> } = {}): Surroundings {
  const census = createCensus(h.cols, h.rows);
  takeCensus(census, creatures);
  const { food, feel } = sensed(h, options.plants ?? 0.8, census.crowd);
  const counts = new Float32Array(BESTIARY.length);
  creatures.forEach((c) => counts[c.kind]++);
  return {
    h,
    feel,
    food,
    census,
    creatures,
    rng: rngOf(options.seed ?? 3),
    year: options.year ?? 0.4,
    minds: options.minds ?? [],
    counts,
    peaks: options.peaks ?? counts,
    born: (kind, x, y, energy) => ({ id: nextId++, kind, x, y, heading: 0, energy, age: 0, doing: 'roam', left: 0 }),
    settle: () => centreOf(h.cols, Math.floor((h.cols * h.rows) / 2)),
  };
}

/** Take a fresh census after creatures moved. */
export const recount = (env: Surroundings) => takeCensus(env.census, env.creatures);
