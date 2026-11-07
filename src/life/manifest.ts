import { smoothstep } from '../math/scalar';
import { move, PACE, type Surroundings } from './behaviour';
import { BESTIARY, type Need, type Species } from './bestiary';
import { canBe, type Creature } from './creature';
import { centreOf, hexAt } from './hexSpace';
import { isVanishing } from './population';

/**
 * Mystic creatures are not born: the world calls them. Each answers one
 * need: the world tipped too far one way (grey skies that will not lift, a
 * drought, land grazed bare, a deep frost, gales, a great storm, stifling
 * still heat, a kind about to vanish). While the need lasts its call grows;
 * once it has lasted long enough the creature appears where the need is
 * greatest, goes where it is needed and works its powers there, and fades
 * when the need has passed, to rest a while before it can come again.
 */
export interface Calling {
  /** Per kind: how loud the world calls it, and steps before it can come again. */
  calling: Float32Array;
  rest: Float32Array;
}

const land = (env: Surroundings, i: number) => !env.h.sea[i];
/** Land that grows plants: where a drought or bare ground matters. */
const meadow = (env: Surroundings, i: number) => land(env, i) && env.food.room[i] > 0.3;

/** How much each hex needs it, 0–1, by what tipped; and the share of the map (the hexes that need it most) whose need counts: wide for a world tipped as a whole, narrow for a storm, none but the neediest hex for a vanishing kind. */
const NEEDS: Record<Need, { at: (env: Surroundings, i: number) => number; wide: number }> = {
  gloom: { at: (env, i) => (land(env, i) ? env.h.cloud[i] : 0), wide: 0.15 },
  drought: { at: (env, i) => (meadow(env, i) ? smoothstep(0.22, 0.03, env.h.wet[i]) * (1 - smoothstep(0, 0.05, env.h.depth[i])) : 0), wide: 0.15 },
  barren: { at: (env, i) => (meadow(env, i) ? (1 - env.food.plants[i] / env.food.room[i]) * smoothstep(6, 12, env.h.temperature[i]) : 0), wide: 0.15 },
  frost: { at: (env, i) => smoothstep(-2, -12, env.h.temperature[i]), wide: 0.15 },
  gale: { at: (env, i) => (land(env, i) ? smoothstep(0.35, 0.55, Math.hypot(env.h.windX[i], env.h.windY[i])) : 0), wide: 0.05 },
  storm: { at: (env, i) => env.feel.storm[i], wide: 0.05 },
  stifling: { at: (env, i) => (land(env, i) ? smoothstep(12, 20, env.h.temperature[i]) * (1 - env.feel.wind[i]) : 0), wide: 0.05 },
  vanishing: { at: (env, i) => (vanishingAt(env).has(i) ? 1 : 0), wide: 0 },
};


/** The hexes the last of a vanishing kind stand on, worked out once per step. */
const lastOnes = new WeakMap<Surroundings, Set<number>>();
function vanishingAt(env: Surroundings): Set<number> {
  let at = lastOnes.get(env);
  if (!at) {
    at = new Set(env.creatures.filter((c) => c.energy > 0 && isVanishing(env, c.kind)).map((c) => hexAt(env.h.cols, env.h.rows, c.x, c.y)));
    lastOnes.set(env, at);
  }
  return at;
}

/** The need on every hex. */
export function needField(need: Need, env: Surroundings, out = new Float32Array(env.h.cols * env.h.rows)): Float32Array {
  const { at } = NEEDS[need];
  for (let i = 0; i < out.length; i++) out[i] = at(env, i);
  return out;
}

/** How much the world needs it: how much the hexes that need it most do, on average (`wide`: their share of the map; 0, the neediest alone). */
export function howNeeded(field: Float32Array, wide = 0.15): number {
  const top = Math.max(1, Math.round(wide * field.length));
  if (top === 1) return Math.max(...field);
  // Needs lie between 0 and 1: sorted into bins, the neediest are taken bin by bin from the top.
  const bins = new Float64Array(BINS + 1);
  const sums = new Float64Array(BINS + 1);
  for (const v of field) {
    const b = Math.round(Math.max(0, Math.min(1, v)) * BINS);
    bins[b]++;
    sums[b] += v;
  }
  let [left, sum] = [top, 0];
  for (let b = BINS; b >= 0 && left > 0; b--) {
    const take = Math.min(left, bins[b]);
    if (take) sum += (sums[b] / bins[b]) * take;
    left -= take;
  }
  return sum / top;
}
const BINS = 100;

/** Need beyond which the world calls; how long it calls (in steps of full need) before the creature comes; how much slower it fades while still needed. */
export const NEEDED = 0.6;
export const CALLS = 60;
const STAYS = 0.3;

const mystics = BESTIARY.flatMap((s, k) => (s.mystic ? [k] : []));

/** Where it can be on that needs it most, if anywhere. */
function neediest(s: Species, env: Surroundings, field: Float32Array): number {
  let [best, most] = [-1, -Infinity];
  for (let i = 0; i < field.length; i++) if (field[i] > most && canBe(s, env.h, i)) [best, most] = [i, field[i]];
  return best;
}

/** One step of the world calling: mystic creatures that come now (to add); those whose need has passed fade (their energy goes to 0). */
export function call(c: Calling, env: Surroundings): Creature[] {
  const came: Creature[] = [];
  const field = new Float32Array(env.h.cols * env.h.rows);
  for (const kind of mystics) {
    const s = BESTIARY[kind];
    const need = howNeeded(needField(s.answers!, env, field), NEEDS[s.answers!].wide);
    const here = env.creatures.filter((o) => o.kind === kind && o.energy > 0);
    for (const o of here) if ((o.left -= need > NEEDED ? STAYS : 1) <= 0) [o.energy, c.rest[kind]] = [0, s.lifespan];
    if (here.length) continue;
    if (c.rest[kind] > 0) {
      c.rest[kind]--;
      continue;
    }
    c.calling[kind] = need > NEEDED ? c.calling[kind] + (need - NEEDED) / (1 - NEEDED) : c.calling[kind] * 0.97;
    const at = c.calling[kind] >= CALLS ? neediest(s, env, field) : -1;
    if (at < 0) continue;
    const { x, y } = centreOf(env.h.cols, at);
    came.push({ ...env.born(kind, x, y, 1), left: s.lifespan, doing: 'answer' });
    c.calling[kind] = 0;
  }
  return came;
}

/** How close it goes to where it is needed, and how much a hex further away counts against going there. */
const NEAR = 1.5;
const FAR = 0.02;

/** One step of a mystic creature: it heads for where the need is greatest (the nearer the likelier) and stays there. */
export function answer(c: Creature, env: Surroundings): void {
  const s = BESTIARY[c.kind];
  const field = needField(s.answers!, env);
  let [goal, best] = [centreOf(env.h.cols, 0), -Infinity];
  for (let i = 0; i < field.length; i++) {
    const p = centreOf(env.h.cols, i);
    const worth = field[i] - FAR * Math.hypot(p.x - c.x, p.y - c.y);
    if (worth > best && canBe(s, env.h, i)) [goal, best] = [p, worth];
  }
  const d = Math.hypot(goal.x - c.x, goal.y - c.y);
  if (d > 0.05) c.heading = Math.atan2(goal.y - c.y, goal.x - c.x);
  move(c, s, env, d > NEAR ? PACE.answer : Math.min(PACE.graze, d / s.speed));
  [c.doing, c.energy] = ['answer', 1];
  c.age++;
}
