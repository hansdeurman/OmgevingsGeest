import { preyOf, type Species } from './bestiary';
import { KINDS } from './census';
import { canBe, discomfort, drawOf, homeOf } from './creature';
import type { Food } from './food';
import type { Feel, Habitat } from './habitat';

/** How much each draws a creature: food (by energy it would get, for its burn), feeling at home, comfort (per °C beyond), others already there. */
const PULL = { food: 0.2, home: 0.3, comfort: 0.05, crowd: 0.15 };
/** Energy per step a hunter reckons on from each of its prey on a hex. */
const PREY_WORTH = 0.02;

/** Who stands where, as far as appeal cares: how many on each hex, and of each kind (`kinds[i * KINDS + kind]`). */
export interface Crowd {
  crowd: ArrayLike<number>;
  kinds?: ArrayLike<number>;
}

/** Energy per step hex `i` would give a creature of kind `s` to eat, prey there included. */
export function foodAt(s: Species, feel: Feel, food: Food, i: number, crowd?: Crowd): number {
  const { plants = 0, fish = 0, elements = 0 } = s.diet;
  const kinds = crowd?.kinds;
  let prey = 0;
  if (kinds) for (const k of preyOf(s)) prey += kinds[i * KINDS + k] * PREY_WORTH;
  return plants * food.plants[i] + fish * food.fish[i] + elements * drawOf(s, feel, i) + prey;
}

/**
 * How much a creature of kind `s` wants to be on hex `i` now, as hungry as
 * it is (0 full – 1 starving): -Infinity where it cannot go.
 */
export function appeal(s: Species, h: Habitat, feel: Feel, food: Food, i: number, hunger: number, crowd?: Crowd): number {
  if (!canBe(s, h, i)) return -Infinity;
  const eat = s.burn > 0 ? (hunger * foodAt(s, feel, food, i, crowd)) / s.burn : 0;
  return PULL.food * eat + PULL.home * homeOf(s, feel, i) - PULL.comfort * discomfort(s, h.temperature[i]) - PULL.crowd * (crowd?.crowd[i] ?? 0);
}
