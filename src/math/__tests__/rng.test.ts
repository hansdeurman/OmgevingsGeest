import { describe, expect, it } from 'vitest';
import { mulberry32, random, rngOf } from '../rng';

describe('random', () => {
  it('draws the same numbers as mulberry32, from a state that can be kept and set back', () => {
    const [r, f] = [rngOf(42), mulberry32(42)];
    const first = [random(r), random(r)];
    expect(first).toEqual([f(), f()]);
    const kept = { ...r };
    const next = random(r);
    Object.assign(r, kept);
    expect(random(r)).toBe(next);
  });

  it('stays between 0 and 1', () => {
    const r = rngOf(7);
    for (let k = 0; k < 1000; k++) {
      const x = random(r);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
