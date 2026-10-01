import { describe, expect, it } from 'vitest';
import { tileableValueNoise2D, valueNoise2D } from '../noise';
import { clamp, smoothstep } from '../scalar';

describe('tileableValueNoise2D', () => {
  it('repeats every period on both axes', () => {
    for (const [x, y] of [[0.3, 0.7], [2.5, 1.1], [3.9, 3.2]]) {
      const v = tileableValueNoise2D(x, y, 4, 9);
      expect(tileableValueNoise2D(x + 4, y, 4, 9)).toBeCloseTo(v, 12);
      expect(tileableValueNoise2D(x, y + 4, 4, 9)).toBeCloseTo(v, 12);
    }
  });

  it('matches plain value noise inside the first period', () => {
    expect(tileableValueNoise2D(1.25, 2.5, 8, 3)).toBeCloseTo(valueNoise2D(1.25, 2.5, 3), 12);
  });
});

describe('scalar helpers', () => {
  it('clamps', () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp(0.4, 0, 1)).toBe(0.4);
  });

  it('smoothsteps between edges', () => {
    expect(smoothstep(0.2, 0.4, 0.1)).toBe(0);
    expect(smoothstep(0.2, 0.4, 0.5)).toBe(1);
    expect(smoothstep(0.2, 0.4, 0.3)).toBeCloseTo(0.5, 12);
  });
});
