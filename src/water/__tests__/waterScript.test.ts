import { describe, expect, it } from 'vitest';
import { createWaterWorld, surfaceOf, totalWater } from '../hexWater';
import { basinScript, basins, phaseAt, phaseEnd, runScript, scriptLength, type WaterScript } from '../waterScript';

/** A closed 3x3 bowl in a 5x5 map, its floor sloping from 1 (west) to 2 (east). */
const W = 9;
const ground = Array.from({ length: 25 }, (_, i) => {
  const [c, r] = [i % 5, Math.floor(i / 5)];
  return c === 0 || r === 0 || c === 4 || r === 4 ? W : 1 + (c - 1) * 0.5;
});
const bowl = [1, 2, 3].flatMap((r) => [1, 2, 3].map((c) => r * 5 + c));
const world = createWaterWorld(5, 5, ground);

describe('runScript', () => {
  const script: WaterScript = [
    { label: 'rain', steps: 3, rain: 0.1, evaporation: 0 },
    { label: 'burst', steps: 2, rain: 0, evaporation: 0, burst: Float32Array.from({ length: 25 }, (_, i) => (i === 6 ? 1 : 0)) },
  ];
  const states = runScript(world, script);

  it('keeps the start and every step after it', () => {
    expect(states).toHaveLength(scriptLength(script) + 1);
    expect(states[0]).toBe(world);
  });

  it('rains through its phase and pours a burst once, at the start of its phase', () => {
    expect(totalWater(states[3])).toBeCloseTo(9 * 0.3, 4); // only the bowl keeps rain: the map's edge drains
    expect(totalWater(states[4])).toBeCloseTo(9 * 0.3 + 1, 4);
    expect(totalWater(states[5])).toBeCloseTo(totalWater(states[4]), 4);
  });

  it('is the same run every time', () => {
    expect(runScript(world, script)[5].depth).toEqual(states[5].depth);
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

describe('basinScript', () => {
  const full = new Array(25).fill(0);
  bowl.forEach((i) => (full[i] = 3 - ground[i])); // filled to level 3
  const script = basinScript(5, 5, full);
  const states = runScript(world, script);
  const spread = (k: number) => {
    const s = bowl.map((i) => surfaceOf(states[k], i));
    return Math.max(...s) - Math.min(...s);
  };

  it('starts dry, fills the basin with rain, and dries it out again in the drought', () => {
    expect(totalWater(states[0])).toBe(0);
    expect(surfaceOf(states[phaseEnd(script, 'Rain')], 6)).toBeGreaterThan(2.5);
    expect(totalWater(states[states.length - 1])).toBeLessThan(0.05);
  });

  it('piles a cloudburst up on one side, and lets it level out again', () => {
    const burst = phaseEnd(script, 'Rain');
    expect(spread(burst + 1)).toBeGreaterThan(0.3);
    expect(spread(phaseEnd(script, 'Cloudburst, one side'))).toBeLessThan(0.05);
  });
});
