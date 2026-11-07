import { describe, expect, it } from 'vitest';
import { createInfluence } from '../../life/powers';
import { centreOf, hexAt } from '../../life/hexSpace';
import { meadow } from '../../life/__tests__/fixtures';
import { avatarGuest, copyAvatar, createAvatar, FORMS, GIFT_ORDER, GIFTS, powersOf, SPIRIT, stepAvatar } from '../avatar';

const [cols, rows] = [10, 8];
const n = cols * rows;

describe('stepAvatar', () => {
  it('walks to where it is sent at its form’s pace, facing that way, and stops there', () => {
    const a = createAvatar(1, 1);
    a.target = { x: 5, y: 1 };
    stepAvatar(a, cols, rows);
    expect(a.x).toBeCloseTo(1 + FORMS.beast.speed);
    expect(a.heading).toBeCloseTo(0);
    for (let k = 0; k < 20; k++) stepAvatar(a, cols, rows);
    expect([a.x, a.y, a.target]).toEqual([5, 1, undefined]);
  });

  it('walks slower as a keeper', () => {
    const [beast, keeper] = [createAvatar(1, 1), createAvatar(1, 1, 'keeper')];
    [beast, keeper].forEach((a) => ((a.target = { x: 8, y: 1 }), stepAvatar(a, cols, rows)));
    expect(keeper.x).toBeLessThan(beast.x);
  });

  it('stays on the map', () => {
    const a = createAvatar(1, 1);
    a.target = { x: -5, y: 40 };
    for (let k = 0; k < 100; k++) stepAvatar(a, cols, rows);
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.y).toBeLessThanOrEqual((rows - 1) * (Math.sqrt(3) / 2) + 1e-6);
  });

  it('spends spirit on a gift, stops when it is spent, and gets it back at rest', () => {
    const a = createAvatar(1, 1);
    a.gift = 'rain';
    stepAvatar(a, cols, rows);
    expect(a.spirit).toBeCloseTo(1 - SPIRIT.cost);
    let steps = 1;
    for (; a.gift && steps < 1000; steps++) stepAvatar(a, cols, rows);
    expect([a.gift, a.spirit]).toEqual([null, 0]);
    expect(steps).toBeCloseTo(1 / SPIRIT.cost, -1);
    stepAvatar(a, cols, rows);
    expect(a.spirit).toBeCloseTo(SPIRIT.back);
  });
});

describe('gifts', () => {
  it('each has a name, a hint, a key and powers', () => {
    expect(new Set(GIFT_ORDER.map((g) => GIFTS[g].key)).size).toBe(GIFT_ORDER.length);
    GIFT_ORDER.forEach((g) => expect(GIFTS[g].powers.length).toBeGreaterThan(0));
  });

  it('works rain where the avatar stands, further as a keeper, nothing without a gift or spirit', () => {
    const h = meadow(cols, rows);
    const at = centreOf(cols, 3 * cols + 4);
    const a = { ...createAvatar(at.x, at.y), gift: 'rain' as const };
    const f = createInfluence(n);
    avatarGuest(a).cast(f, h);
    expect(f.rain[3 * cols + 4]).toBeGreaterThan(0.3);
    expect(f.mist[3 * cols + 4]).toBeGreaterThan(0);
    expect(f.rain[0]).toBe(0);
    expect(powersOf({ ...a, form: 'keeper' })[0].reach).toBe(GIFTS.rain.powers[0].reach + 1);
    expect(powersOf({ ...a, gift: null })).toEqual([]);
    expect(powersOf({ ...a, spirit: 0 })).toEqual([]);
  });

  it('drives the wind the way it faces, warms with the sun, grows plants', () => {
    const h = meadow(cols, rows);
    const at = centreOf(cols, 3 * cols + 4);
    const i = hexAt(cols, rows, at.x, at.y);
    const cast = (gift: 'wind' | 'sun' | 'grow', heading = 0) => {
      const f = createInfluence(n);
      avatarGuest({ ...createAvatar(at.x, at.y), gift, heading }).cast(f, h);
      return f;
    };
    expect(cast('wind', Math.PI / 2).gustY[i]).toBeGreaterThan(0.1);
    expect(cast('sun').heat[i]).toBeGreaterThan(0.4);
    expect(cast('sun').thin[i]).toBeGreaterThan(0);
    expect(cast('grow').grow[i]).toBeGreaterThan(2);
  });

  it('calms the creatures around it, and draws them near: a mind of no creature’s kind', () => {
    const a = { ...createAvatar(2, 2), gift: 'calm' as const };
    const mind = avatarGuest(a).mind({ counts: [], peaks: [] })!;
    expect(mind).toMatchObject({ x: 2, y: 2, kind: -1, calm: 3, pulls: undefined });
    expect(mind.pull).toBeGreaterThan(0);
    expect(avatarGuest({ ...a, gift: 'rain' }).mind({ counts: [], peaks: [] })).toBeUndefined();
  });
});

describe('copyAvatar', () => {
  it('copies it whole, its target too', () => {
    const a = { ...createAvatar(1, 1), target: { x: 3, y: 3 } };
    const b = copyAvatar(a);
    b.target!.x = 9;
    expect(a.target.x).toBe(3);
  });
});
