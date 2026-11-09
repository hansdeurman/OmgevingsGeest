import { describe, expect, it } from 'vitest';
import { kindOf } from '../bestiary';
import { centreOf } from '../hexSpace';
import { castPowers, createInfluence, mindsOf } from '../powers';
import { creature, meadow } from './fixtures';

const [cols, rows] = [9, 7];
const middle = 3 * cols + 4;

describe('castPowers', () => {
  it('warms the hex a salamander stands on, and no other', () => {
    const f = createInfluence(cols * rows);
    castPowers(f, [creature('salamander', cols, middle)], meadow(cols, rows));
    expect(f.heat[middle]).toBeCloseTo(0.03);
    expect(f.heat[middle + 1]).toBe(0);
  });

  it('spreads a mystic’s powers over its reach, weaker further out', () => {
    const f = createInfluence(cols * rows);
    castPowers(f, [creature('phoenix', cols, middle)], meadow(cols, rows));
    expect(f.heat[middle]).toBeGreaterThan(f.heat[middle + 2]);
    expect(f.heat[middle + 2]).toBeGreaterThan(0);
    expect(f.heat[0]).toBe(0);
  });

  it('pushes the wind the way a swallow flies, and stills it around a golem', () => {
    const f = createInfluence(cols * rows);
    castPowers(f, [creature('swallow', cols, middle, { heading: Math.PI / 2 }), creature('golem', cols, 0)], meadow(cols, rows));
    expect(f.gustY[middle]).toBeGreaterThan(0);
    expect(Math.abs(f.gustX[middle])).toBeLessThan(1e-9);
    expect(f.still[0]).toBeGreaterThan(0.5);
    expect(f.still[0]).toBeLessThan(1);
  });

  it('works water and plants: rain, mist, frost, growth, thinner clouds', () => {
    const f = createInfluence(cols * rows);
    const h = meadow(cols, rows);
    castPowers(f, [creature('raindragon', cols, middle), creature('hare', cols, 0), creature('sunmane', cols, cols * rows - 1)], h);
    expect(f.rain[middle]).toBeGreaterThan(0);
    expect(f.gather[middle]).toBeGreaterThan(0);
    expect(f.mist[middle]).toBeGreaterThan(0);
    expect(f.grow[0]).toBeGreaterThan(0);
    expect(f.thin[cols * rows - 1]).toBeGreaterThan(0);
  });

  it('works nothing while asleep, or where it is starting afresh', () => {
    const f = createInfluence(cols * rows);
    castPowers(f, [creature('salamander', cols, middle, { doing: 'sleep' })], meadow(cols, rows));
    expect(f.heat[middle]).toBe(0);
    f.heat[1] = 5;
    castPowers(f, [], meadow(cols, rows));
    expect(f.heat[1]).toBe(0);
  });
});

describe('mindsOf', () => {
  it('lists those who lure, scare or calm, where they are and how far they reach', () => {
    const owl = creature('dreamowl', cols, middle);
    const minds = mindsOf([owl, creature('hare', cols, 0), creature('kitsune', cols, 5)]);
    expect(minds.map((m) => [m.kind, m.calm])).toEqual([
      [kindOf('dreamowl'), 0],
      [kindOf('kitsune'), 3],
    ]);
    expect(minds[0]).toMatchObject({ ...centreOf(cols, middle), pull: 1, reach: 2 });
    expect(minds[1].pull).toBeGreaterThan(0);
  });

  it('lets the kitsune keep hunters off the kinds about to vanish only', () => {
    const fox = kindOf('sparkfox');
    const counts = new Float32Array(30);
    const peaks = new Float32Array(30);
    [counts[fox], peaks[fox]] = [1, 6];
    const [kitsune] = mindsOf([creature('kitsune', cols, 5)], { counts, peaks });
    expect(kitsune.shields).toEqual([fox]);
    expect(mindsOf([creature('dreamowl', cols, 5)])[0].shields).toBeUndefined();
  });
});
