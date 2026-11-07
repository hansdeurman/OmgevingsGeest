import { describe, expect, it } from 'vitest';
import { BESTIARY, kindOf } from '../bestiary';
import { answer, call, CALLS, howNeeded, needField, type Calling } from '../manifest';
import { centreOf, hexAt } from '../hexSpace';
import { creature, meadow, surroundings } from './fixtures';

const [cols, rows] = [10, 8];
const n = cols * rows;
const corner = n - 1;

describe('needField', () => {
  it('feels each need where the world has tipped', () => {
    const h = meadow(cols, rows, (i) => (i === 0 ? { cloud: 1, wet: 0, temperature: -20 } : i === 1 ? { sea: 1, cloud: 1 } : i === 2 ? { windX: 0.6, temperature: 25 } : i === 3 ? { temperature: 25, fall: 0.2 } : {}));
    const peaks = new Float32Array(BESTIARY.length).fill(10);
    const env = surroundings(h, [creature('hare', cols, 5)], { plants: (i) => (i === 4 ? 0 : 0.9), peaks });
    const at = (need: Parameters<typeof needField>[0], i: number) => needField(need, env)[i];
    expect([at('gloom', 0), at('gloom', 1), at('gloom', 5)]).toEqual([1, 0, 0]);
    expect(at('drought', 0)).toBe(1);
    expect(at('drought', 5)).toBe(0);
    expect(at('frost', 0)).toBe(1);
    expect(at('gale', 2)).toBe(1);
    expect(at('storm', 3)).toBe(1);
    expect(at('stifling', 3)).toBe(1);
    expect(at('stifling', 2)).toBe(0);
    expect(at('barren', 4)).toBeGreaterThan(0.9);
    expect(at('barren', 5)).toBeLessThan(0.2);
    expect(at('vanishing', hexAt(cols, rows, env.creatures[0].x, env.creatures[0].y))).toBe(1);
  });

  it('feels no vanishing where every kind is many, or a rare kind has always been few', () => {
    const many = Array.from({ length: 5 }, (_, k) => creature('hare', cols, k));
    expect(Math.max(...needField('vanishing', surroundings(meadow(cols, rows), many)))).toBe(0);
    expect(Math.max(...needField('vanishing', surroundings(meadow(cols, rows), [creature('sunstag', cols, 3)])))).toBe(0);
  });
});

describe('howNeeded', () => {
  it('weighs the hexes that need it most', () => {
    const field = new Float32Array(100);
    field.fill(1, 0, 15);
    expect(howNeeded(field)).toBeCloseTo(1);
    expect(howNeeded(new Float32Array(100).fill(0.2))).toBeCloseTo(0.2);
  });
});

describe('call', () => {
  const frozen = () => surroundings(meadow(cols, rows, (i) => ({ temperature: i === corner ? -25 : -10 })), []);
  const phoenix = kindOf('phoenix');
  const calling = (): Calling => ({ calling: new Float32Array(BESTIARY.length), rest: new Float32Array(BESTIARY.length) });

  it('calls a mystic creature when the need lasts, where it is greatest, once', () => {
    const [env, c] = [frozen(), calling()];
    let came: ReturnType<typeof call> = [];
    for (let k = 0; k < 400 && !came.length; k++) came = call(c, env);
    const bird = came.find((b) => b.kind === phoenix)!;
    expect(bird).toBeDefined();
    expect(hexAt(cols, rows, bird.x, bird.y)).toBe(corner);
    env.creatures.push(...came);
    for (let k = 0; k < 50; k++) expect(call(c, env).filter((b) => b.kind === phoenix)).toEqual([]);
  });

  it('does not call it for a short cold spell', () => {
    const [env, c] = [frozen(), calling()];
    for (let k = 0; k < CALLS / 2; k++) expect(call(c, env).filter((b) => b.kind === phoenix)).toEqual([]);
  });

  it('lets it fade once the need has passed, and not come again soon after', () => {
    const [env, c] = [frozen(), calling()];
    const bird = creature('phoenix', cols, corner, { left: 10 });
    env.creatures.push(bird);
    const mild = surroundings(meadow(cols, rows), [bird]);
    for (let k = 0; k < 12; k++) call(c, mild);
    expect(bird.energy).toBe(0);
    env.creatures.length = 0;
    for (let k = 0; k < 400; k++) expect(call(c, env).filter((b) => b.kind === phoenix)).toEqual([]);
  });
});

describe('answer', () => {
  it('takes a mystic creature to where it is needed most', () => {
    const env = surroundings(meadow(cols, rows, (i) => ({ temperature: i === corner ? -25 : 5 })), []);
    const bird = creature('phoenix', cols, 0);
    for (let k = 0; k < 120; k++) answer(bird, env);
    const goal = centreOf(cols, corner);
    expect(Math.hypot(bird.x - goal.x, bird.y - goal.y)).toBeLessThan(2);
    expect(bird.doing).toBe('answer');
  });
});
