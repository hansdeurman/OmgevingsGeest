import { smoothstep, soft } from '../math/scalar';
import type { Habitat } from './habitat';

/**
 * What the land and the water give to eat: plants on every hex of land, up
 * to what its grass and trees let grow, and fish in the sea and in lakes
 * and rivers deep enough. Plants grow in mild, moist and sunny weather,
 * rest under snow, die back in the cold and drown where a lake rises; the
 * creatures graze them down, and they grow back from what is left (and
 * from seed). Strong growing powers make the land itself greener: more can
 * grow there, for years, until it slowly goes back to how it was. Fish
 * breed up to what their water holds, and die with it.
 */
export interface Food {
  /** Plants per hex, as a share of the most any hex grows; the most each hex grows now, and as the land was at first. */
  plants: Float32Array;
  room: Float32Array;
  base: Float32Array;
  fish: Float32Array;
}

/** Share of plants that grows per step at best, what grows from seed, and the share that dies back per step when it is too cold to grow. */
const GROW = { rate: 0.012, seed: 0.02, frost: 0.0015, below: 2 };
/** Share of fish born per step at best, and from their few. */
const BREED = { rate: 0.02, seed: 0.02 };

/** The most a hex grows, by its grass and trees (levels 0–4) and its height: bare above the tree line. */
export const plantRoom = (grass: number, trees: number, height: number) => (0.2 + 0.8 * Math.min(1, (grass + trees) / 5)) * (1 - smoothstep(4.5, 7.5, height));

/** The fish a hex's water holds at most. */
const pond = (h: Habitat, i: number) => (h.sea[i] ? 1 : smoothstep(0.15, 1, h.depth[i]));
/** The plants a hex holds at most now: none in the sea, few under a lake. */
const meadow = (food: Food, h: Habitat, i: number) => (h.sea[i] ? 0 : food.room[i] * (1 - smoothstep(0.2, 0.8, h.depth[i])));

export function createFood(room: ArrayLike<number>, h: Habitat): Food {
  const food: Food = { room: Float32Array.from(room), base: Float32Array.from(room), plants: new Float32Array(room.length), fish: new Float32Array(room.length) };
  for (let i = 0; i < room.length; i++) [food.plants[i], food.fish[i]] = [0.7 * meadow(food, h, i), 0.6 * pond(h, i)];
  return food;
}

/** How well plants grow on hex `i` now, 0–1: warm enough, moist, unburied, lit. */
function growing(h: Habitat, i: number): number {
  const t = h.temperature[i];
  const warmth = smoothstep(2, 12, t) * (1 - smoothstep(30, 42, t));
  return warmth * smoothstep(0.05, 0.5, h.wet[i]) * (1 - smoothstep(0, 0.1, h.snow[i])) * (0.5 + 0.5 * h.sun * (1 - h.cloud[i]));
}

/** Logistic growth of `x` towards `most`, at `rate`, from at least `seed`; above `most`, it falls back to it. */
const toward = (x: number, most: number, rate: number, seed: number) => (x > most ? most + (x - most) * 0.95 : x + rate * (x + seed) * (1 - x / most));

/** The most powers make plants grow faster, all together: so many times again. */
const MOST_BOOST = 4;
/** Growth beyond this boost greens the land: the share of what it could still grow that it gains per step per boost beyond; and the share of the way back to how it was it goes per step without. */
const GREENING = { from: 0.5, rate: 0.004, back: 0.0003 };
/** The most a hex at this height can ever grow (bare rock above the tree line). */
/** The most plants ground this high grows when it is as green as it gets. */
export const terrainMost = (height: number) => 1 - smoothstep(4.5, 7.5, height);

/** One step of growing, in place; `boost` per hex makes plants grow that many times faster again (tailing off towards `MOST_BOOST`), and a strong one greens the land. */
export function growFood(food: Food, h: Habitat, boost: ArrayLike<number>): void {
  const { plants, fish, room, base } = food;
  for (let i = 0; i < plants.length; i++) {
    const b = soft(boost[i], MOST_BOOST);
    room[i] = h.sea[i] ? 0 : b > GREENING.from ? room[i] + GREENING.rate * (b - GREENING.from) * Math.max(0, terrainMost(h.height[i]) - room[i]) : room[i] + (base[i] - room[i]) * GREENING.back;
    const most = meadow(food, h, i);
    plants[i] = most > 0 ? toward(plants[i], most, GROW.rate * growing(h, i) * (1 + b), GROW.seed) : 0;
    if (h.temperature[i] < GROW.below) plants[i] *= 1 - GROW.frost;
    const holds = pond(h, i);
    fish[i] = holds > 0.01 ? Math.min(holds, toward(fish[i], holds, BREED.rate * (h.temperature[i] > 0 ? 1 : 0.3), BREED.seed)) : 0;
  }
}

/** Take up to `want` from `field` at `i`: what was there to take. */
export function take(field: Float32Array, i: number, want: number): number {
  const got = Math.min(field[i], want);
  field[i] -= got;
  return got;
}
