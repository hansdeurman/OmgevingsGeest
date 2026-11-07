import { BESTIARY, type Species } from './bestiary';
import { DRAWS_ON, type Quality } from './elements';
import type { Feel, Habitat } from './habitat';
import { ring } from './hexSpace';

/**
 * One creature: where it is (in hex spacings, anywhere on the map), which
 * way it faces, how much energy it has (0 starving – 1 full), how old it
 * is and what it is doing. Mystic creatures also have the steps left before
 * they fade, which the world's need keeps topping up.
 */
export interface Creature {
  id: number;
  kind: number;
  x: number;
  y: number;
  heading: number;
  energy: number;
  age: number;
  doing: Doing;
  /** Mystic: steps left; ordinary: steps since it last bred. */
  left: number;
}

export type Doing = 'roam' | 'graze' | 'hunt' | 'flee' | 'sleep' | 'away' | 'answer';

export const speciesOf = (c: Creature): Species => BESTIARY[c.kind];

/** Where a creature can be: in the air anywhere; on land walking; wading, on land, in lakes and rivers and along the coast; swimming only in water. */
export function canBe(s: Species, h: Habitat, i: number): boolean {
  switch (s.moves) {
    case 'fly':
      return true;
    case 'swim':
      return !!h.sea[i] || h.depth[i] > 0.15;
    case 'wade':
      return !h.sea[i] || nearLand(h, i);
    default:
      return !h.sea[i] && h.depth[i] < 0.3;
  }
}

/** Whether a hex of sea lies next to land. */
function nearLand(h: Habitat, i: number): boolean {
  const near = ring(h.cols, h.rows);
  for (let d = 0; d < 6; d++) if (near[6 * i + d] >= 0 && !h.sea[near[6 * i + d]]) return true;
  return false;
}

/** Degrees the air is beyond what it is comfortable in. */
export const discomfort = (s: Species, t: number) => Math.max(0, s.comfort[0] - t, t - s.comfort[1]);

/** Whether it sleeps now, through the cold. */
export const asleep = (s: Species, t: number) => !!s.sleeps && t < s.comfort[0];

/** Degrees warmer than it can bear it needs before it comes back from the winter. */
const BACK = 2;

/** Whether a migrating creature is away now: it leaves when it gets too cold, and comes back once spring is warm enough (`spring`: it is the time of year). */
export const away = (s: Species, t: number, gone: boolean, spring: boolean) => !!s.migrates && (gone ? !spring || t < s.comfort[0] + BACK : t < s.comfort[0]);

/** Whether it is about in the world now: not away for the winter. */
export const about = (c: Creature) => c.doing !== 'away';

const DRAWS = new Map<Species, { food: readonly Quality[]; home: readonly Quality[] }>();
const drawing = (s: Species) => {
  let d = DRAWS.get(s);
  if (!d) DRAWS.set(s, (d = { home: s.types.map((t) => DRAWS_ON[t]), food: s.diet.on ?? s.types.map((t) => DRAWS_ON[t]) }));
  return d;
};

/** The qualities a creature draws on to eat: its own, or its elements'. */
export const drawsOn = (s: Species): readonly Quality[] => drawing(s).food;

const meanOf = (qs: readonly Quality[], feel: Feel, i: number) => {
  let sum = 0;
  for (const q of qs) sum += feel[q][i];
  return sum / qs.length;
};

/** How much of what it draws on to eat hex `i` has, 0–1. */
export const drawOf = (s: Species, feel: Feel, i: number) => meanOf(drawing(s).food, feel, i);

/** How much at home a creature is on hex `i`, by its elements, 0–1. */
export const homeOf = (s: Species, feel: Feel, i: number) => meanOf(drawing(s).home, feel, i);
