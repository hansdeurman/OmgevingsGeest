import { random, type Rng } from '../math/rng';
import { YEAR } from '../water/sun';
import { appeal, foodAt } from './appeal';
import { BESTIARY, preyOf, type Species } from './bestiary';
import { closest, countNear, middleOf, type Census } from './census';
import { asleep, BACK, canBe, discomfort, drawOf, leaves, speciesOf, type Creature, type Doing } from './creature';
import { matchup } from './elements';
import { take, type Food } from './food';
import type { Feel, Habitat } from './habitat';
import { hexAt, inside, ROW } from './hexSpace';
import type { Population } from './population';

/**
 * What one ordinary creature does in a step: it feels the hexes around it
 * and heads for the one that suits it best (food, its element, comfort,
 * room), away from hunters, after prey when hungry, after its own kind if
 * it keeps to them, and as other minds pull or push it; it moves (the wind
 * carries fliers along), eats, uses energy (more out of its comfort, less
 * asleep), breeds in its season with a mate near, and dies when it starves
 * or grows old.
 */
export interface Surroundings extends Population {
  h: Habitat;
  feel: Feel;
  food: Food;
  census: Census;
  creatures: Creature[];
  rng: Rng;
  /** Share of the year since midwinter. */
  year: number;
  minds: readonly Mind[];
  /** A new creature: its id and place in the world are given it there. */
  born(kind: number, x: number, y: number, energy: number): Creature;
  /** A spot that would suit a creature of `kind` coming into the world now, if any. */
  settle(kind: number): { x: number; y: number } | undefined;
}

/** A creature that pulls (lure: above 0) or pushes (scare) others' minds within `reach` (of the kinds it `pulls`, or all others), and keeps hunters from hunting within `calm` of it (the kinds it `shields`, or any). */
export interface Mind {
  x: number;
  y: number;
  kind: number;
  reach: number;
  pull: number;
  pulls?: readonly number[];
  calm: number;
  shields?: readonly number[];
}

type Vec = { x: number; y: number };

/** How far it sees (hex spacings), scents prey when hungry, seeks a mate; and catches prey (beyond both their sizes). */
const SENSE = { fly: 4, other: 3, hunt: 12, mate: 8 };
const CATCH = 0.3;
/** Share of its speed it goes at, doing each thing. */
export const PACE: Record<Doing, number> = { roam: 0.6, graze: 0.2, hunt: 1.2, flee: 1.3, sleep: 0, away: 0, answer: 1 };
/** How strongly each pulls its heading: hunters, prey, a mate, its own kind (beyond this far). */
const PULL = { flee: 3, hunt: 2, mate: 1, kin: 0.6, kinFrom: 1.5 };
/** Most it turns per step, and how much it wanders. */
const TURN = 0.9;
const WANDER = 0.5;
/** Share of the wind a flier is carried by; wind creatures ride it. */
const DRIFT = { fly: 0.25, wind: 0.6 };
/** Plants and fish (shares of a full hex) a creature eats for energy, per hex spacing of its size. */
const COST = 0.5;
/** Energy a kill gives, per its size against the hunter's; chance of a catch, at an even match; the fewer of a kind there are, the better they hide (half as well caught at this many). */
const MEAT = 0.8;
const CATCHES = 0.3;
const HIDE = 8;
/** Asleep, a creature is tucked away: this much as likely to be caught. */
const HIDDEN = 0.4;
/** Breeding: from spring to late summer; energy it takes per young; most creatures around for it to breed; most of a kind there can be. */
export const SEASON = [0.25, 0.65] as const;
const BROOD_COST = 0.12;
const CROWDED = { within: 1.5, most: 10 };
/** The most there can be of a kind that does not say. */
export const MOST_OF_A_KIND = 6;

const sightOf = (s: Species) => (s.moves === 'fly' ? SENSE.fly : SENSE.other);
const length = (v: Vec) => Math.hypot(v.x, v.y);
const unit = (from: Vec, to: Vec, w = 1): Vec => {
  const d = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: (w * (to.x - from.x)) / d, y: (w * (to.y - from.y)) / d };
};
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const hexOf = (env: Surroundings, c: Vec) => hexAt(env.h.cols, env.h.rows, c.x, c.y);
const alive = (c: Creature) => c.energy > 0;

/** How far it looks along each of the six directions for a better hex, in hex spacings. */
const LOOK = [1, 2, 3];
const RAYS = Array.from({ length: 6 }, (_, d) => ({ x: Math.cos((d * Math.PI) / 3), y: Math.sin((d * Math.PI) / 3) }));

/** Towards the hexes around that suit it better than this one, the more and the nearer the better; stranded, to the nearest it can be on. */
export function habitatPull(c: Creature, s: Species, env: Surroundings): Vec {
  const { h, feel, food, census } = env;
  const i = hexOf(env, c);
  const hunger = 1 - c.energy;
  const value = (j: number) => appeal(s, h, feel, food, j, hunger, census);
  const here = value(i) + (census.crowd[i] > 0 ? 0.15 : 0);
  let v: Vec = { x: 0, y: 0 };
  let way: { to: Vec; worth: number } | undefined;
  for (const ray of RAYS)
    for (const r of LOOK) {
      const to = { x: c.x + ray.x * r, y: c.y + ray.y * r };
      if (!inside(h.cols, h.rows, to.x, to.y)) break;
      const there = value(hexOf(env, to));
      if (there === -Infinity) continue;
      if (here === -Infinity) way = way ?? { to, worth: there };
      else if (there > here) v = add(v, { x: (ray.x * (there - here)) / r, y: (ray.y * (there - here)) / r });
    }
  return way ? unit(c, way.to, 2) : v;
}

/** The nearest living creature within sight that passes `keep`, if any. */
function nearest(c: Creature, s: Species, env: Surroundings, kinds: readonly number[], keep: (o: Creature) => boolean, sight = sightOf(s)): Creature | undefined {
  const k = closest(env.census, env.creatures, c.x, c.y, sight, (k) => env.creatures[k] !== c && alive(env.creatures[k]) && keep(env.creatures[k]), kinds);
  return k < 0 ? undefined : env.creatures[k];
}

/** Per kind, the kinds that hunt it, and itself alone. */
const HUNTERS = BESTIARY.map((_, kind) => BESTIARY.flatMap((s, k) => (preyOf(s).includes(kind) ? [k] : [])));
const SELF = BESTIARY.map((_, kind) => [kind]);

/** Hunters go after prey below this energy: only then are they a threat. */
const HUNGRY = 0.5;

/** Whether `hunter` is out for creatures of `kind`: awake, hungry, and hunting that kind. */
const hunts = (hunter: Creature, kind: number) => hunter.doing !== 'sleep' && hunter.energy < HUNGRY && preyOf(speciesOf(hunter)).includes(kind);

export const threatTo = (c: Creature, s: Species, env: Surroundings) => (HUNTERS[c.kind].length ? nearest(c, s, env, HUNTERS[c.kind], (o) => hunts(o, c.kind)) : undefined);
export const preyFor = (c: Creature, s: Species, env: Surroundings) => (preyOf(s).length ? nearest(c, s, env, preyOf(s), () => true, SENSE.hunt) : undefined);

/** In season, grown and well fed: towards the nearest grown one of its kind, to breed. */
function matePull(c: Creature, s: Species, env: Surroundings): Vec {
  if (c.age < s.matures || c.energy < 0.7 || !inSeason(env.year)) return { x: 0, y: 0 };
  const mate = nearest(c, s, env, SELF[c.kind], (o) => o.age >= s.matures, SENSE.mate);
  return mate && Math.hypot(mate.x - c.x, mate.y - c.y) > 1 ? unit(c, mate, PULL.mate) : { x: 0, y: 0 };
}

/** Towards the middle of its own kind around it, when it has strayed from them. */
function kinPull(c: Creature, s: Species, env: Surroundings): Vec {
  const mid = middleOf(env.census, c.x, c.y, sightOf(s), c.kind);
  if (mid.count < 2) return { x: 0, y: 0 };
  return Math.hypot(mid.x - c.x, mid.y - c.y) > PULL.kinFrom ? unit(c, mid, PULL.kin) : { x: 0, y: 0 };
}

/** The pull of other minds on it (towards a lure, away from a scare), stronger nearer. */
export function mindPull(c: Creature, env: Surroundings): Vec {
  let v: Vec = { x: 0, y: 0 };
  for (const m of env.minds) {
    const d = Math.hypot(m.x - c.x, m.y - c.y);
    if (m.kind === c.kind || !m.pull || d > m.reach || d < 0.3 || (m.pulls && !m.pulls.includes(c.kind))) continue;
    v = add(v, unit(c, m, m.pull * (1 - d / m.reach)));
  }
  return v;
}

/** Whether a calming mind keeps creatures of `kind` from being hunted here. */
export const calmAt = (env: Surroundings, p: Vec, kind: number) => env.minds.some((m) => m.calm > 0 && Math.hypot(m.x - p.x, m.y - p.y) <= m.calm && (!m.shields || m.shields.includes(kind)));

/** Turn towards `v` (by at most TURN), wandering a little; with nowhere to go, wander more. */
function turn(c: Creature, v: Vec, rng: Rng): void {
  const jitter = (random(rng) - 0.5) * WANDER;
  if (length(v) < 0.02) return void (c.heading += 2 * jitter);
  let delta = Math.atan2(v.y, v.x) - c.heading;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  c.heading += Math.max(-TURN, Math.min(TURN, delta)) + jitter;
}

/** Decide what to do and which way to head; what it will do is returned, and kept on it. */
export function steer(c: Creature, s: Species, env: Surroundings): { doing: Doing; prey?: Creature } {
  const t = env.h.temperature[hexOf(env, c)];
  if (c.doing === 'away' ? !homecoming(c, s, env) : leaves(s, t)) return { doing: 'away' };
  if (asleep(s, t)) return { doing: 'sleep' };
  let v = habitatPull(c, s, env);
  const fed = foodAt(s, env.feel, env.food, hexOf(env, c)) > s.burn;
  let doing: Doing = length(v) < 0.05 && fed ? 'graze' : 'roam';
  const threat = threatTo(c, s, env);
  const prey = !threat && c.energy < HUNGRY ? preyFor(c, s, env) : undefined;
  if (threat) [v, doing] = [add(v, unit(threat, c, PULL.flee)), 'flee'];
  else if (prey) [v, doing] = [add(v, unit(c, prey, PULL.hunt)), 'hunt'];
  v = add(v, s.herds ? kinPull(c, s, env) : matePull(c, s, env));
  v = add(v, mindPull(c, env));
  turn(c, v, env.rng);
  return { doing, prey };
}

/** Back from the winter, in its season, to a spot warm enough for it, if there is one: whether it came. */
function homecoming(c: Creature, s: Species, env: Surroundings): boolean {
  const spot = inSeason(env.year) ? env.settle(c.kind) : undefined;
  if (!spot || env.h.temperature[hexOf(env, spot)] < s.comfort[0] + BACK) return false;
  [c.x, c.y] = [spot.x, spot.y];
  return true;
}

/** The next spot ahead, `speed` along `heading`. */
const ahead = (c: Vec, heading: number, speed: number): Vec => ({ x: c.x + Math.cos(heading) * speed, y: c.y + Math.sin(heading) * speed });

/** Move on at `pace`: around what it cannot cross, slower uphill on foot, carried by the wind in the air; kept on the map. */
export function move(c: Creature, s: Species, env: Surroundings, pace: number): void {
  const { h } = env;
  const i = hexOf(env, c);
  if (s.moves === 'fly') {
    const drift = s.types.includes('wind') ? DRIFT.wind : DRIFT.fly;
    const to = ahead(c, c.heading, s.speed * pace);
    [c.x, c.y] = [to.x + h.windX[i] * drift, to.y + h.windY[i] * drift];
  } else {
    for (const bend of [0, 1, -1, 2, -2, 3]) {
      const heading = c.heading + (bend * Math.PI) / 3;
      const j = hexOf(env, ahead(c, heading, s.speed * pace));
      if (j !== i && !canBe(s, h, j)) continue;
      const climb = s.moves === 'climb' ? 0 : Math.max(0, h.height[j] - h.height[i]);
      const to = ahead(c, heading, (s.speed * pace) / (1 + 0.6 * climb));
      [c.x, c.y, c.heading] = [to.x, to.y, heading];
      break;
    }
  }
  keepOnMap(c, h.cols, h.rows);
}

/** Back onto the map, turned away from the edge it went over. */
function keepOnMap(c: Creature, cols: number, rows: number): void {
  if (inside(cols, rows, c.x, c.y)) return;
  const [w, hgt] = [cols - 0.5, (rows - 1) * ROW];
  if (c.x < 0 || c.x > w) c.heading = Math.PI - c.heading;
  if (c.y < 0 || c.y > hgt) c.heading = -c.heading;
  c.x = Math.max(0, Math.min(w, c.x));
  c.y = Math.max(0, Math.min(hgt, c.y));
}

/** Eat what the hex gives, as much as it has room for: plants and fish (taken from the hex), its element (there to take). */
export function feed(c: Creature, s: Species, env: Surroundings): number {
  const i = hexOf(env, c);
  const { plants = 0, fish = 0, elements = 0 } = s.diet;
  let gain = 0;
  const graze = (field: Float32Array, rate: number) => {
    const want = Math.min(rate, 1 - c.energy - gain);
    if (want > 0) gain += take(field, i, want * s.size * COST) / (s.size * COST);
  };
  graze(env.food.plants, plants);
  graze(env.food.fish, fish);
  gain += Math.max(0, Math.min(elements * drawOf(s, env.feel, i), 1 - c.energy - gain));
  c.energy += gain;
  return gain;
}

/** Try to catch `prey` if near enough, and eat it. */
export function strike(c: Creature, s: Species, env: Surroundings, prey: Creature): boolean {
  const ps = speciesOf(prey);
  if (Math.hypot(prey.x - c.x, prey.y - c.y) > CATCH + (s.size + ps.size) / 2 || calmAt(env, c, prey.kind)) return false;
  const few = env.counts[prey.kind] / (env.counts[prey.kind] + HIDE);
  const chance = CATCHES * matchup(s.types, ps.types) * few * (prey.doing === 'sleep' ? HIDDEN : 1);
  if (random(env.rng) >= chance) return false;
  prey.energy = 0;
  c.energy = Math.min(1, c.energy + (MEAT * ps.size) / s.size);
  return true;
}

/** Energy used this step: more out of its comfort and in a hurry, far less asleep, none while away (it lives elsewhere). */
export const burnOf = (s: Species, t: number, doing: Doing) => (doing === 'away' ? 0 : s.burn * (1 + 0.06 * discomfort(s, t)) * (doing === 'sleep' ? 0.25 : PACE[doing] > 1 ? 1.3 : 1));

export const inSeason = (year: number) => year >= SEASON[0] && year <= SEASON[1];

/** Young, if it breeds now: grown, well fed, in season, long enough since its last brood, with a mate near and room around. */
export function breed(c: Creature, s: Species, env: Surroundings): Creature[] {
  const window = (SEASON[1] - SEASON[0]) * YEAR;
  if (s.mystic || c.doing === 'away' || c.age < s.matures || c.energy < 0.7 || !inSeason(env.year) || c.left < window / (2 * s.broods)) return [];
  if (env.counts[c.kind] >= (s.most ?? MOST_OF_A_KIND) || random(env.rng) >= s.broods / window) return [];
  const mate = nearest(c, s, env, SELF[c.kind], (o) => o.age >= s.matures && o.doing !== 'sleep', 2);
  if (!mate || countNear(env.census, env.creatures, c.x, c.y, CROWDED.within) > CROWDED.most) return [];
  c.energy -= BROOD_COST * s.brood;
  c.left = 0;
  return Array.from({ length: s.brood }, () => env.born(c.kind, c.x + (random(env.rng) - 0.5) * 0.3, c.y + (random(env.rng) - 0.5) * 0.3, 0.45));
}

/** Whether it dies now: starved, or of old age (any step past its years, likelier the older). */
export const dies = (c: Creature, s: Species, rng: Rng) => c.energy <= 0 || (c.age > s.lifespan && random(rng) < 0.01 * (1 + (c.age - s.lifespan) / s.lifespan));

/** One step of an ordinary creature's life; its young, if any. */
export function live(c: Creature, env: Surroundings): Creature[] {
  const s = BESTIARY[c.kind];
  const { doing, prey } = steer(c, s, env);
  c.doing = doing;
  const active = doing !== 'sleep' && doing !== 'away';
  if (active) move(c, s, env, PACE[doing]);
  if (prey) strike(c, s, env, prey);
  if (active) feed(c, s, env);
  c.energy -= burnOf(s, env.h.temperature[hexOf(env, c)], doing);
  c.age++;
  c.left++;
  return breed(c, s, env);
}
