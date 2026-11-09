import { describe, expect, it } from 'vitest';
import { breed, burnOf, calmAt, dies, feed, habitatPull, live, mindPull, move, steer, strike } from '../behaviour';
import { BESTIARY, kindOf } from '../bestiary';
import { canBe, type Creature } from '../creature';
import { centreOf, hexAt } from '../hexSpace';
import { rngOf } from '../../math/rng';
import { creature, meadow, recount, spot, surroundings } from './fixtures';

const sp = (id: string) => BESTIARY[kindOf(id)];
const [cols, rows] = [12, 10];
const middle = 5 * cols + 5;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
/** Let the creatures live `k` steps, counting them afresh each step; the dead are left out. */
function run(env: ReturnType<typeof surroundings>, k: number): void {
  for (let s = 0; s < k; s++) {
    for (const c of [...env.creatures]) if (c.energy > 0) env.creatures.push(...live(c, env));
    env.creatures.splice(0, env.creatures.length, ...env.creatures.filter((c) => c.energy > 0));
    recount(env);
  }
}

describe('habitatPull', () => {
  it('points a hungry grazer at the green hex next to it', () => {
    const h = meadow(cols, rows);
    const hare = creature('hare', cols, middle, { energy: 0.1 });
    const env = surroundings(h, [hare], { plants: (i) => (i === middle + 1 ? 1 : 0.05) });
    const v = habitatPull(hare, sp('hare'), env);
    expect(v.x).toBeGreaterThan(0.3);
    expect(Math.abs(v.y)).toBeLessThan(0.05);
  });

  it('gets a stranded walker out of the water', () => {
    const h = meadow(cols, rows, (i) => (i === middle ? { depth: 1 } : {}));
    const hare = creature('hare', cols, middle);
    const v = habitatPull(hare, sp('hare'), surroundings(h, [hare]));
    expect(Math.hypot(v.x, v.y)).toBeGreaterThan(1);
  });
});

describe('steer and move', () => {
  it('walks a hungry hare onto the meadow from bare ground', () => {
    const h = meadow(cols, rows);
    const hare = creature('hare', cols, 5 * cols + 1, { energy: 0.3 });
    const env = surroundings(h, [hare], { plants: (i) => (i % cols >= 4 ? 1 : 0) });
    run(env, 60);
    expect(hare.x).toBeGreaterThan(3.5);
  });

  it('runs a hare from a fox, and the fox after it', () => {
    const h = meadow(cols, rows);
    const hare = creature('hare', cols, middle);
    const fox = creature('sparkfox', cols, middle - 2, { energy: 0.3 });
    const env = surroundings(h, [hare, fox]);
    expect(steer(hare, sp('hare'), env).doing).toBe('flee');
    const { doing, prey } = steer(fox, sp('sparkfox'), env);
    expect([doing, prey]).toEqual(['hunt', hare]);
  });

  it('never walks into the sea, but flies over it, carried by the wind', () => {
    const h = meadow(cols, rows, (i) => (i % cols >= 6 ? { sea: 1, height: 0, windX: 0.3 } : { windX: 0.3 }));
    const [hare, swallow] = [creature('hare', cols, 5 * cols + 4), creature('swallow', cols, 5 * cols + 4, { heading: Math.PI / 2 })];
    const env = surroundings(h, [hare, swallow], { plants: 0 });
    for (let k = 0; k < 40; k++) {
      hare.heading = 0;
      move(hare, sp('hare'), env, 1);
      expect(canBe(sp('hare'), h, hexAt(cols, rows, hare.x, hare.y))).toBe(true);
    }
    const x = swallow.x;
    move(swallow, sp('swallow'), env, 0);
    expect(swallow.x - x).toBeCloseTo(0.3 * 0.6);
  });

  it('keeps every creature on the map', () => {
    const h = meadow(cols, rows);
    const swallow = creature('swallow', cols, 0, { heading: Math.PI * 1.2 });
    const env = surroundings(h, [swallow]);
    for (let k = 0; k < 20; k++) move(swallow, sp('swallow'), env, 1);
    expect(swallow.x).toBeGreaterThanOrEqual(0);
    expect(swallow.y).toBeGreaterThanOrEqual(0);
  });

  it('sleeps through the cold if it can, and does not move asleep', () => {
    const h = meadow(cols, rows, () => ({ temperature: -2 }));
    const salamander = creature('salamander', cols, middle);
    const env = surroundings(h, [salamander]);
    const at = { ...salamander };
    live(salamander, env);
    expect(salamander.doing).toBe('sleep');
    expect([salamander.x, salamander.y]).toEqual([at.x, at.y]);
    expect(burnOf(sp('salamander'), -2, 'sleep')).toBeLessThan(burnOf(sp('salamander'), 10, 'roam') / 2);
  });
});

describe('minds', () => {
  it('lures others towards an owl, but not its own kind, and calms hunting near a kitsune', () => {
    const h = meadow(cols, rows);
    const hare = creature('hare', cols, middle);
    const owl = { ...spot(cols, middle + 1), kind: kindOf('dreamowl'), reach: 2, pull: 1, calm: 0 };
    const kitsune = { ...spot(cols, 0), kind: kindOf('kitsune'), reach: 0, pull: 0, calm: 3 };
    const env = surroundings(h, [hare], { minds: [owl, kitsune] });
    expect(mindPull(hare, env).x).toBeGreaterThan(0);
    expect(mindPull(creature('dreamowl', cols, middle), env).x).toBe(0);
    expect(calmAt(env, spot(cols, 1), hare.kind)).toBe(true);
    expect(calmAt(env, hare, hare.kind)).toBe(false);
  });
});

describe('feed and strike', () => {
  it('grazes plants down for energy, no more than it has room for', () => {
    const h = meadow(cols, rows);
    const hare = creature('hare', cols, middle, { energy: 0.5 });
    const env = surroundings(h, [hare], { plants: 1 });
    expect(feed(hare, sp('hare'), env)).toBeCloseTo(sp('hare').diet.plants!);
    expect(env.food.plants[middle]).toBeLessThan(1);
    hare.energy = 0.995;
    expect(feed(hare, sp('hare'), env)).toBeCloseTo(0.005);
    expect(hare.energy).toBeCloseTo(1);
  });

  it('feeds a glowmoth on sunshine, which no one takes from another', () => {
    const h = meadow(cols, rows);
    const moth = creature('glowmoth', cols, middle);
    const env = surroundings(h, [moth], { plants: 0 });
    expect(feed(moth, sp('glowmoth'), env)).toBeGreaterThan(0.005);
  });

  it('catches prey within reach, now and then, and none where it is calm', () => {
    const h = meadow(cols, rows);
    const fox = creature('sparkfox', cols, middle, { energy: 0.2 });
    const hare = creature('hare', cols, middle, { x: centreOf(cols, middle).x + 0.3 });
    const env = surroundings(h, [fox, hare]);
    let caught = false;
    for (let k = 0; k < 30 && !caught; k++) caught = strike(fox, sp('sparkfox'), env, hare);
    expect(caught).toBe(true);
    expect(hare.energy).toBe(0);
    expect(fox.energy).toBeGreaterThan(0.6);
    const calm = surroundings(h, [fox, { ...hare, energy: 0.5 }], { minds: [{ ...fox, reach: 0, pull: 0, calm: 2 }] });
    for (let k = 0; k < 30; k++) expect(strike(fox, sp('sparkfox'), calm, calm.creatures[1])).toBe(false);
  });
});

describe('breed and die', () => {
  const pair = () => [creature('hare', cols, middle, { energy: 0.9 }), creature('hare', cols, middle, { energy: 0.9, x: centreOf(cols, middle).x + 0.5 })];
  const tries = (env: ReturnType<typeof surroundings>, c: Creature) => {
    for (let k = 0; k < 500; k++) {
      const young = breed(c, sp('hare'), env);
      if (young.length) return young;
    }
    return [];
  };

  it('has young with a mate near, in spring and summer', () => {
    const [a, b] = pair();
    const young = tries(surroundings(meadow(cols, rows), [a, b]), a);
    expect(young).toHaveLength(sp('hare').brood);
    expect(young[0].energy).toBeLessThan(a.energy + 0.1);
    expect(a.left).toBe(0);
  });

  it('has none alone, in winter, too young or hungry', () => {
    const [a, b] = pair();
    expect(tries(surroundings(meadow(cols, rows), [a]), a)).toEqual([]);
    expect(tries(surroundings(meadow(cols, rows), [a, b], { year: 0.9 }), a)).toEqual([]);
    expect(tries(surroundings(meadow(cols, rows), [{ ...a, age: 10 }, b]), { ...a, age: 10 })).toEqual([]);
    expect(tries(surroundings(meadow(cols, rows), [{ ...a, energy: 0.3 }, b]), { ...a, energy: 0.3 })).toEqual([]);
  });

  it('dies starved, or old', () => {
    const rng = rngOf(1);
    expect(dies(creature('hare', cols, 0, { energy: 0 }), sp('hare'), rng)).toBe(true);
    expect(dies(creature('hare', cols, 0, { age: 10 }), sp('hare'), rng)).toBe(false);
    const old = creature('hare', cols, 0, { age: 2 * sp('hare').lifespan });
    expect(Array.from({ length: 200 }, () => dies(old, sp('hare'), rng)).some(Boolean)).toBe(true);
  });
});

describe('live', () => {
  it('keeps a few hares and a fox going on a green meadow for a while, the fox eating some', () => {
    const h = meadow(cols, rows);
    const hares = Array.from({ length: 8 }, (_, k) => creature('hare', cols, 2 * cols + 2 + k, { energy: 0.8 }));
    const fox = creature('sparkfox', cols, 7 * cols + 6, { energy: 0.4 });
    const env = surroundings(h, [...hares, fox], { plants: 0.9 });
    run(env, 200);
    const left = env.creatures.filter((c) => c.kind === kindOf('hare'));
    expect(left.length).toBeGreaterThan(0);
    expect(dist(fox, centreOf(cols, 7 * cols + 6))).toBeGreaterThan(0.5);
    expect(env.creatures).toContain(fox);
  });
});
