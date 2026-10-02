import { describe, expect, it } from 'vitest';
import { piecewise } from '../scalar';

describe('piecewise', () => {
  const ramp = piecewise([
    [0, 0],
    [1, 10],
    [3, 10],
    [4, 0],
  ]);

  it('runs straight between its points', () => {
    expect(ramp(0.5)).toBeCloseTo(5);
    expect(ramp(2)).toBe(10);
    expect(ramp(3.5)).toBeCloseTo(5);
  });

  it('holds its end values beyond its ends', () => {
    expect(ramp(-2)).toBe(0);
    expect(ramp(9)).toBe(0);
  });
});
