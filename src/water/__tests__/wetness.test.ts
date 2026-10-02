import { describe, expect, it } from 'vitest';
import { WETNESS, wetness, wetnessMap } from '../wetness';

describe('wetness', () => {
  it('runs from parched over dry to normal as the ground fills', () => {
    expect(wetness(0, 0)).toBe(WETNESS.parched);
    expect(wetness(0.2, 0)).toBeCloseTo(WETNESS.dry, 1);
    expect(wetness(0.55, 0)).toBe(WETNESS.normal);
  });

  it('keeps a wide band of ordinary ground normal', () => {
    expect(wetness(0.4, 0)).toBe(WETNESS.normal);
    expect(wetness(0.75, 0)).toBe(WETNESS.normal);
  });

  it('turns moist when the ground is full, soaked once water stands on it', () => {
    expect(wetness(0.95, 0)).toBe(WETNESS.moist);
    expect(wetness(1, 0.06)).toBeCloseTo(WETNESS.soaked, 1);
  });

  it('puts the hex under water once more stands on it than the ground takes, deeper as it rises', () => {
    expect(wetness(1, 0.25)).toBeCloseTo(WETNESS.flooded, 1);
    expect(wetness(1, 1)).toBeGreaterThan(WETNESS.flooded);
    expect(wetness(1, 1)).toBeLessThan(wetness(1, 3));
    expect(wetness(1, 99)).toBe(WETNESS.deep);
  });

  it('lets standing water wet even dry ground, but a passing film does not', () => {
    expect(wetness(0, 0.3)).toBeGreaterThan(WETNESS.soaked);
    expect(wetness(0, 0.002)).toBe(WETNESS.parched);
  });

  it('only gets wetter with more water', () => {
    let last = -1;
    for (let k = 0; k <= 100; k++) {
      const w = wetness(k / 100, (k / 100) ** 2);
      expect(w).toBeGreaterThanOrEqual(last);
      last = w;
    }
  });
});

describe('wetnessMap', () => {
  it('reads each hex from its soil, its capacity and the water on it', () => {
    const map = wetnessMap(Float32Array.of(0.5, 0.5, 0.5), Float32Array.of(0, 0.25, 0.5), Float32Array.of(0, 0, 0.1));
    expect(Array.from(map)).toEqual([WETNESS.parched, WETNESS.normal, Math.fround(wetness(1, 0.1))]);
  });

  it('lets the sea and the map edge be wet only by their soil: what flows in there is gone', () => {
    const map = wetnessMap(Float32Array.of(0.5), Float32Array.of(0.25), Float32Array.of(5), Uint8Array.of(1));
    expect(map[0]).toBe(WETNESS.normal);
  });
});
