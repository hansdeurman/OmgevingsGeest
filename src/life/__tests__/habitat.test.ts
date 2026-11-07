import { describe, expect, it } from 'vitest';
import { createHydroWorld } from '../../water/hydroWorld';
import { soakOf } from '../../water/retention';
import { createWaterCycle, cycleStep } from '../../water/waterCycle';
import { createFeel, feel, habitatOf, type Habitat } from '../habitat';

const [cols, rows] = [4, 3];
const n = cols * rows;
const at = (values: Record<number, number>, base = 0) => Float32Array.from({ length: n }, (_, i) => values[i] ?? base);

/** A small world by hand: hex 0 is sea, 1 a lake, 2 a peak; 5 is hot, 6 freezing; a storm over 7, a gale over 8. */
const habitat = (): Habitat => ({
  cols,
  rows,
  height: at({ 0: 0, 2: 8 }, 1),
  depth: at({ 1: 1 }),
  sea: at({ 0: 1 }),
  wet: at({ 3: 0.5 }, 0.2),
  snow: at({ 2: 2 }),
  temperature: at({ 5: 30, 6: -20 }, 8),
  cloud: at({ 7: 1, 9: 1 }),
  fall: at({ 7: 0.2 }),
  windX: at({ 8: 0.5 }, 0.02),
  windY: at({}),
  sun: 1,
});

describe('feel', () => {
  const f = createFeel(n);
  feel(habitat(), at({ 4: 0.8 }), at({ 10: 3, 11: 3 }), f);

  it('feels water in the sea, lakes and wet soil', () => {
    expect([f.wet[0], f.wet[1]]).toEqual([1, 1]);
    expect(f.wet[3]).toBeGreaterThan(f.wet[4]);
  });

  it('feels warmth and cold by the air’s temperature', () => {
    expect(f.warm[5]).toBeGreaterThan(0.9);
    expect(f.cold[6]).toBe(1);
    expect(f.warm[6]).toBe(0);
    expect(f.cold[4]).toBeLessThan(0.2);
  });

  it('feels the sun where the sky is clear, a storm where it rains hard, and the wind', () => {
    expect(f.sun[4]).toBe(1);
    expect(f.sun[9]).toBe(0);
    expect(f.cloud[9]).toBe(1);
    expect(f.storm[7]).toBe(1);
    expect(f.storm[9]).toBe(0);
    expect(f.wind[8]).toBe(1);
    expect(f.wind[4]).toBeLessThan(0.1);
  });

  it('feels the heights, the plants, and other creatures around', () => {
    expect(f.high[2]).toBe(1);
    expect(f.high[4]).toBe(0);
    expect(f.green[4]).toBeCloseTo(0.8);
    expect(f.minds[10]).toBeGreaterThan(f.minds[4]);
    expect(f.minds[6]).toBe(f.minds[10]);
    expect(f.minds[0]).toBe(0);
  });
});

describe('habitatOf', () => {
  it('reads a water cycle’s world and sky', () => {
    const ground = Array.from({ length: n }, (_, i) => (i % cols === 0 ? 0 : 2));
    const c = createWaterCycle(createHydroWorld({ cols, rows, ground, soak: () => soakOf(2, 0, 2), soil: () => 0.05 }));
    for (let k = 0; k < 3; k++) cycleStep(c);
    const h = habitatOf(c);
    expect(h.temperature).toBe(c.temperature);
    expect(h.sea[0]).toBe(1);
    expect(h.wet[1]).toBeGreaterThan(0);
    expect(h.sun).toBeGreaterThan(0.5);
    expect(h.sun).toBeLessThanOrEqual(1);
  });
});
