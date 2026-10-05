import { describe, expect, it } from 'vitest';
import type { Puff } from '../cloudDeck';
import { CLOUD_ASPECT, CLOUD_INSTANCE, cloudInstances, RAIN_INSTANCE, rainInstances } from '../cloudGLData';

const puff = (x: number, y: number, extra: Partial<Puff> = {}): Puff => ({ x, y, size: 40, target: 40, shown: 1, dark: 0, fall: 0, snow: false, shape: 1, seed: 7, ...extra });
const view = { scale: 2, x: 10, y: 20, squash: 0.5, altitude: 30 };

describe('cloudInstances', () => {
  it('places each puff its altitude above its ground, as wide as it is, back to front', () => {
    const data = cloudInstances([puff(100, 300), puff(50, 100, { dark: 0.5, shown: 0.4, shape: 3 })], view);
    expect(data.length).toBe(2 * CLOUD_INSTANCE);
    // The one further back (smaller y) comes first.
    [10 + 50 * 2, 20 + (100 * 0.5 - 30) * 2, 80, 3, 0.5, 0.4].forEach((v, k) => expect(data[k]).toBeCloseTo(v, 5));
    expect(data[CLOUD_INSTANCE + 1]).toBe(20 + (300 * 0.5 - 30) * 2);
  });

  it('leaves out puffs that do not show', () => {
    expect(cloudInstances([puff(1, 1, { shown: 0 })], view).length).toBe(0);
  });
});

describe('rainInstances', () => {
  it('hangs a shaft from under each raining cloud down over the ground it rains on', () => {
    const data = rainInstances([puff(100, 300, { fall: 0.8, snow: true }), puff(0, 0)], view);
    expect(data.length).toBe(RAIN_INSTANCE);
    const [left, top, width, height, fall, snow] = data;
    const [cx, cy, w] = [10 + 100 * 2, 20 + (300 * 0.5 - 30) * 2, 80];
    expect(left + width / 2).toBeCloseTo(cx);
    expect(width).toBeLessThan(w);
    expect(top).toBeGreaterThan(cy);
    expect(top).toBeLessThan(cy + (w * CLOUD_ASPECT) / 2);
    expect(top + height).toBeGreaterThan(20 + 300 * 0.5 * 2);
    expect(top + height).toBeLessThan(20 + 300 * 0.5 * 2 + w * CLOUD_ASPECT);
    expect(fall).toBeCloseTo(0.8, 5);
    expect(snow).toBe(1);
  });
});
