import { describe, expect, it } from 'vitest';
import { glacierOf, soakMap, soakOf, temperature, weatherStep, type Weather } from '../retention';

/** One hex with this ground and soak, run through `steps` of weather; returns its stores after each step. */
const runHex = (elevation: number, soak: ReturnType<typeof soakOf>, weather: (k: number) => Weather, steps: number, snow0 = 0, depth0 = 0) => {
  const [ground, depth, soil, snow] = [Float32Array.of(elevation), Float32Array.of(depth0), new Float32Array(1), Float32Array.of(snow0)];
  const map = soakMap([soak]);
  return Array.from({ length: steps }, (_, k) => {
    weatherStep(ground, depth, soil, snow, map, weather(k));
    return { depth: depth[0], soil: soil[0], snow: snow[0] };
  });
};
const meadow = soakOf(3, 0, 1);
const rain = (r: number, warmth = 0): Weather => ({ rain: r, warmth, evaporation: 0 });

describe('soakOf', () => {
  it('lets forest hold more water than meadow, meadow more than bare sand, bare rock high up least', () => {
    const [forest, sand, rock] = [soakOf(3, 4, 1), soakOf(0, 0, 1), soakOf(0, 0, 7)];
    expect(forest.capacity).toBeGreaterThan(meadow.capacity);
    expect(meadow.capacity).toBeGreaterThan(sand.capacity);
    expect(rock.capacity).toBeLessThan(sand.capacity);
  });

  it('lets forest give its water back slowest', () => {
    expect(soakOf(3, 4, 1).release).toBeLessThan(meadow.release);
  });
});

describe('temperature', () => {
  it('is colder higher up and warmer in summer', () => {
    expect(temperature(7, 0)).toBeLessThan(temperature(1, 0));
    expect(temperature(4, 1)).toBeGreaterThan(temperature(4, -1));
    expect(temperature(7.5, 0)).toBeLessThan(0);
  });
});

describe('weatherStep', () => {
  it('soaks light rain up into the ground until it is full; only then does water run off', () => {
    const steps = runHex(1, meadow, () => rain(0.01), 200);
    expect(steps[5].depth).toBeLessThan(0.002);
    expect(steps[5].soil).toBeGreaterThan(0.04);
    expect(steps[199].soil).toBeCloseTo(meadow.capacity, 1);
    expect(steps[199].depth).toBeGreaterThan(0.1);
  });

  it('gives soaked-up water back slowly, long after the rain has stopped', () => {
    // On a slope: whatever stands on the hex runs off each step.
    const [ground, depth, soil, snow] = [Float32Array.of(1), new Float32Array(1), new Float32Array(1), new Float32Array(1)];
    const map = soakMap([meadow]);
    const runoff = Array.from({ length: 240 }, (_, k) => {
      weatherStep(ground, depth, soil, snow, map, rain(k < 40 ? 0.02 : 0));
      const off = depth[0];
      depth[0] = 0;
      return off;
    });
    expect(runoff[100]).toBeGreaterThan(0);
    expect(runoff[200]).toBeGreaterThan(0);
    expect(runoff[200]).toBeLessThan(runoff[100]);
  });

  it('turns cold rain into snow, which melts when it warms up', () => {
    const steps = runHex(7.5, soakOf(0, 0, 7.5), (k) => rain(k < 20 ? 0.02 : 0, k < 20 ? -0.5 : 1), 200);
    expect(steps[19].snow).toBeCloseTo(0.4, 2);
    expect(steps[19].depth).toBe(0);
    expect(steps[40].snow).toBeLessThan(steps[19].snow);
    expect(steps[40].depth + steps[40].soil).toBeGreaterThan(0);
  });

  it('melts a glacier slowly: it keeps giving water for a long time', () => {
    const ice = glacierOf(7.5);
    expect(ice).toBeGreaterThan(0);
    expect(glacierOf(4)).toBe(0);
    const steps = runHex(7.5, soakOf(0, 0, 7.5), () => rain(0, 1), 300, ice);
    expect(steps[150].snow).toBeGreaterThan(0);
    expect(steps[150].snow).toBeLessThan(ice);
  });

  it('dries a thin stream far slower than open water: it covers only part of its hex', () => {
    const lost = (start: number) => start - runHex(1, { capacity: 0, infiltration: 0, release: 0 }, () => ({ rain: 0, warmth: 1, evaporation: 0.01 }), 1, 0, start)[0].depth;
    expect(lost(0.02)).toBeLessThan(lost(2) / 10);
    expect(lost(0.02)).toBeGreaterThan(0);
  });

  it('dries standing water faster the warmer it is', () => {
    const dry = (warmth: number) => runHex(1, soakOf(0, 0, 1), (k) => ({ rain: k === 0 ? 1 : 0, warmth, evaporation: 0.01 }), 30)[29].depth;
    expect(dry(1)).toBeLessThan(dry(-0.5));
  });

  it('keeps the ground moist in a cool, wet spring', () => {
    const steps = runHex(1, meadow, () => ({ rain: 0.0045, warmth: 0.3, evaporation: 0.002 }), 200);
    expect(steps[199].soil).toBeGreaterThan(meadow.capacity * 0.8);
  });
});
