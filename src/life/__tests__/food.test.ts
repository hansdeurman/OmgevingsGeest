import { describe, expect, it } from 'vitest';
import { createFood, growFood, plantRoom, take } from '../food';
import type { Habitat } from '../habitat';

const n = 6;
const fill = (v: number) => new Float32Array(n).fill(v);
/** Six hexes of meadow, mild and moist, in sunshine; hex 5 is sea, hex 4 a lake. */
const meadow = (change: Partial<Habitat> = {}): Habitat => ({
  cols: n,
  rows: 1,
  height: Float32Array.from([1, 1, 1, 1, 1, 0]),
  depth: Float32Array.from([0, 0, 0, 0, 1.5, 0]),
  sea: Float32Array.from([0, 0, 0, 0, 0, 1]),
  wet: fill(0.6),
  snow: fill(0),
  temperature: fill(15),
  cloud: fill(0),
  fall: fill(0),
  windX: fill(0),
  windY: fill(0),
  sun: 1,
  ...change,
});
const steps = (food: ReturnType<typeof createFood>, h: Habitat, k: number, boost = fill(0)) => {
  for (let s = 0; s < k; s++) growFood(food, h, boost);
};

describe('plantRoom', () => {
  it('lets grass and trees grow more, and little grow on the bare peaks', () => {
    expect(plantRoom(4, 2, 1)).toBeGreaterThan(plantRoom(1, 0, 1));
    expect(plantRoom(4, 4, 1)).toBeLessThanOrEqual(1);
    expect(plantRoom(2, 0, 8)).toBeLessThan(0.1);
  });
});

describe('growFood', () => {
  const room = fill(1);

  it('grows plants up to what a hex holds in mild, moist sunshine, and from nothing', () => {
    const food = createFood(room, meadow());
    food.plants.fill(0);
    steps(food, meadow(), 600);
    expect(food.plants[0]).toBeGreaterThan(0.9);
    expect(food.plants[0]).toBeLessThanOrEqual(1);
  });

  it('grows none in the sea or under a deep lake, nor in dry ground', () => {
    const food = createFood(room, meadow());
    steps(food, meadow({ wet: fill(0) }), 300);
    expect(food.plants[5]).toBe(0);
    expect(food.plants[4]).toBeLessThan(0.05);
    const before = food.plants[0];
    steps(food, meadow({ wet: fill(0) }), 50);
    expect(food.plants[0]).toBeLessThanOrEqual(before);
  });

  it('stands still under snow, and dies back in the frost', () => {
    const food = createFood(room, meadow());
    const before = food.plants[0];
    steps(food, meadow({ snow: fill(1), temperature: fill(5) }), 100);
    expect(food.plants[0]).toBeCloseTo(before, 6);
    steps(food, meadow({ temperature: fill(-5) }), 100);
    expect(food.plants[0]).toBeLessThan(before * 0.9);
  });

  it('grows faster where a power makes it', () => {
    const [a, b] = [createFood(room, meadow()), createFood(room, meadow())];
    a.plants.fill(0.1);
    b.plants.fill(0.1);
    steps(a, meadow(), 30);
    steps(b, meadow(), 30, fill(2));
    expect(b.plants[0]).toBeGreaterThan(a.plants[0] * 1.5);
  });

  it('breeds fish in the sea and lakes, none on land, and they die as a lake dries', () => {
    const food = createFood(room, meadow());
    food.fish.fill(0);
    steps(food, meadow(), 600);
    expect(food.fish[5]).toBeGreaterThan(0.9);
    expect(food.fish[4]).toBeGreaterThan(0.5);
    expect(food.fish[0]).toBe(0);
    steps(food, meadow({ depth: fill(0) }), 1);
    expect(food.fish[4]).toBe(0);
  });
});

describe('take', () => {
  it('takes what is asked, but never more than there is', () => {
    const field = Float32Array.from([0.3]);
    expect(take(field, 0, 0.1)).toBeCloseTo(0.1);
    expect(take(field, 0, 1)).toBeCloseTo(0.2);
    expect(field[0]).toBe(0);
  });
});
