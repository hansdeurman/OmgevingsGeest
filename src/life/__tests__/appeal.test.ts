import { describe, expect, it } from 'vitest';
import { appeal } from '../appeal';
import { BESTIARY, kindOf } from '../bestiary';
import { meadow, sensed } from './fixtures';

const sp = (id: string) => BESTIARY[kindOf(id)];
const [cols, rows] = [6, 4];

describe('appeal', () => {
  it('draws a hungry hunter to where its prey is', () => {
    const h = meadow(cols, rows);
    const { food, feel } = sensed(h, 0);
    const kinds = new Float32Array(cols * rows * BESTIARY.length);
    kinds[3 * BESTIARY.length + kindOf('hare')] = 2;
    const crowd = { crowd: new Float32Array(cols * rows), kinds };
    expect(appeal(sp('sparkfox'), h, feel, food, 3, 1, crowd)).toBeGreaterThan(appeal(sp('sparkfox'), h, feel, food, 2, 1, crowd) + 1);
  });

  it('draws a hungry grazer to plants, a full one hardly', () => {
    const h = meadow(cols, rows);
    const { food, feel } = sensed(h, (i) => (i === 1 ? 1 : 0.1));
    const pull = (hunger: number) => appeal(sp('hare'), h, feel, food, 1, hunger) - appeal(sp('hare'), h, feel, food, 2, hunger);
    expect(pull(1)).toBeGreaterThan(0.5);
    expect(pull(0)).toBeLessThan(pull(1) / 3);
  });

  it('draws each to its element: fire to warmth, stone to heights, fish-eaters to fish', () => {
    const h = meadow(cols, rows, (i) => (i === 1 ? { temperature: 28 } : i === 8 ? { height: 6 } : i === 7 ? { depth: 1 } : {}));
    const { food, feel } = sensed(h);
    expect(appeal(sp('salamander'), h, feel, food, 1, 0.5)).toBeGreaterThan(appeal(sp('salamander'), h, feel, food, 2, 0.5));
    expect(appeal(sp('goat'), h, feel, food, 8, 0)).toBeGreaterThan(appeal(sp('goat'), h, feel, food, 2, 0));
    expect(appeal(sp('otter'), h, feel, food, 7, 1)).toBeGreaterThan(appeal(sp('otter'), h, feel, food, 2, 1));
  });

  it('keeps each out of the cold and heat it cannot bear', () => {
    const h = meadow(cols, rows, (i) => (i === 1 ? { temperature: -20 } : {}));
    const { food, feel } = sensed(h);
    expect(appeal(sp('swallow'), h, feel, food, 1, 0.5)).toBeLessThan(appeal(sp('swallow'), h, feel, food, 2, 0.5) - 0.5);
  });

  it('shuts out where it cannot go, and thins out crowds', () => {
    const h = meadow(cols, rows, (i) => (i === 1 ? { sea: 1, height: 0 } : {}));
    const crowd = new Float32Array(cols * rows);
    crowd[3] = 5;
    const { food, feel } = sensed(h, 0.8, crowd);
    expect(appeal(sp('hare'), h, feel, food, 1, 0.5)).toBe(-Infinity);
    expect(appeal(sp('swallow'), h, feel, food, 1, 0.5)).toBeGreaterThan(-Infinity);
    expect(appeal(sp('hare'), h, feel, food, 3, 0.5, { crowd })).toBeLessThan(appeal(sp('hare'), h, feel, food, 2, 0.5, { crowd }));
  });
});
