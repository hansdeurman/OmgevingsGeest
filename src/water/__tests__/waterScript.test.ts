import { describe, expect, it } from 'vitest';
import { createHydroWorld, totalWater } from '../hydroWorld';
import { basins, phaseAt, phaseEnd, runScript, scriptLength, seasonScript, type WaterScript } from '../waterScript';

/** A closed 3x3 bowl in a 5x5 map, on bare ground that holds no water. */
const W = 9;
const ground = Array.from({ length: 25 }, (_, i) => {
  const [c, r] = [i % 5, Math.floor(i / 5)];
  return c === 0 || r === 0 || c === 4 || r === 4 ? W : 1 + (c - 1) * 0.5;
});
const world = () => createHydroWorld({ cols: 5, rows: 5, ground, soak: () => ({ capacity: 0, infiltration: 0, release: 0 }) });

describe('runScript', () => {
  const script: WaterScript = [
    { label: 'rain', steps: 3, rain: 0.1, warmth: 0.5, evaporation: 0 },
    { label: 'burst', steps: 2, rain: 0, warmth: 0.5, evaporation: 0, burst: Float32Array.from({ length: 25 }, (_, i) => (i === 6 ? 1 : 0)) },
  ];
  const states = runScript(world(), script);

  it('keeps the start and every step after it', () => {
    expect(states).toHaveLength(scriptLength(script) + 1);
    expect(totalWater(states[0].depth)).toBe(0);
  });

  it('rains through its phase and pours a burst once, at the start of its phase', () => {
    expect(totalWater(states[3].depth)).toBeCloseTo(9 * 0.3, 4); // only the bowl keeps rain: the map's edge drains
    expect(totalWater(states[4].depth)).toBeCloseTo(9 * 0.3 + 1, 4);
    expect(totalWater(states[5].depth)).toBeCloseTo(totalWater(states[4].depth), 4);
  });

  it('is the same run every time', () => {
    expect(runScript(world(), script)[5].depth).toEqual(states[5].depth);
  });

  it('knows the step at which each phase ends', () => {
    expect(phaseEnd(script, 'rain')).toBe(3);
    expect(phaseEnd(script, 'burst')).toBe(5);
    expect(phaseEnd(script, 'nothing')).toBe(5);
  });

  it('names the phase running at every step', () => {
    expect([0, 1, 3, 4, 5].map((k) => phaseAt(script, k).label)).toEqual(['rain', 'rain', 'rain', 'burst', 'burst']);
  });
});

describe('basins', () => {
  it('groups the cells that hold water into connected basins', () => {
    const water = new Array(25).fill(0);
    [6, 7, 18].forEach((i) => (water[i] = 1));
    expect(basins(5, 5, water).map((b) => b.sort((a, c) => a - c))).toEqual([[6, 7], [18]]);
  });
});

describe('seasonScript', () => {
  const full = ground.map((g) => (g < W ? 3 - g : 0));
  const script = seasonScript(5, 5, ground, full);

  it('runs through a year: snow, rain, a cloudburst, drought, an autumn storm', () => {
    expect(script.map((p) => p.label)).toEqual(['Winter', 'Spring rain', 'Cloudburst, one side', 'Dry summer', 'Autumn storm', 'Autumn']);
    expect(script[0].warmth).toBeLessThan(0);
    expect(script[3].rain).toBe(0);
  });

  it('rains more on the mountains than on the lowlands', () => {
    const rain = script[1].rain as Float32Array;
    expect(rain[2 * 5 + 3]).toBeGreaterThan(rain[2 * 5 + 1]);
  });

  it('bursts on one side of each basin only', () => {
    const burst = script[2].burst!;
    expect(burst[2 * 5 + 1]).toBeGreaterThan(0);
    expect(burst[2 * 5 + 3]).toBe(0);
  });

  it('dries a bare bowl out in the summer', () => {
    const states = runScript(world(), script);
    expect(totalWater(states[phaseEnd(script, 'Dry summer')].depth)).toBeLessThan(totalWater(states[phaseEnd(script, 'Cloudburst, one side')].depth));
  });

  it('storms in autumn: far more rain than in spring', () => {
    const [spring, storm] = [script[1].rain as Float32Array, script[4].rain as Float32Array];
    expect(storm[2 * 5 + 1]).toBeGreaterThan(5 * spring[2 * 5 + 1]);
  });
});
