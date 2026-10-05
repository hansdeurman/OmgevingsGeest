import { describe, expect, it } from 'vitest';
import { createClimate } from '../climate';
import { createHydroWorld, totalWater } from '../hydroWorld';
import { soakOf } from '../retention';
import { createRun } from '../waterRun';
import { createWaterCycle, cycleModel, cycleStep } from '../waterCycle';

/** Sea in the west, land rising to a ridge in the east. */
const [cols, rows] = [12, 8];
const ground = Array.from({ length: cols * rows }, (_, i) => (i % cols < 3 ? 0 : (i % cols) * 0.7));
const cycle = () =>
  createWaterCycle(
    createHydroWorld({ cols, rows, ground, soak: (i) => soakOf(2, 1, ground[i]), soil: () => 0.1 }),
    createClimate(5),
  );

describe('createWaterCycle', () => {
  it('starts with air as humid as the sea makes it and no clouds', () => {
    const c = cycle();
    expect(totalWater(c.air.vapour)).toBeGreaterThan(0);
    expect(totalWater(c.air.cloud)).toBe(0);
    expect(c.air.sea[0]).toBe(1);
    expect(c.air.sea[cols - 1]).toBe(0);
  });
});

describe('cycleStep', () => {
  it('rains on the land from the air, and what evaporates rises into it', () => {
    const c = cycle();
    let fell = 0;
    for (let k = 0; k < 300; k++) {
      cycleStep(c);
      for (let i = 0; i < c.air.fall.length; i++) if (!c.world.sink[i]) fell += c.air.fall[i];
    }
    expect(fell).toBeGreaterThan(0);
    expect(c.step).toBe(300);
  });
});

describe('cycleModel', () => {
  it('goes back to a moment and on again exactly as it went the first time', () => {
    const run = createRun(cycleModel(cycle()), Infinity, 25);
    const seen = [run.at(60), run.at(130)].map((v) => ({ depth: Array.from(v.depth), cloud: Array.from(v.sky.cloud) }));
    run.at(10);
    expect({ depth: Array.from(run.at(60).depth), cloud: Array.from(run.at(60).sky.cloud) }).toEqual(seen[0]);
    expect({ depth: Array.from(run.at(130).depth), cloud: Array.from(run.at(130).sky.cloud) }).toEqual(seen[1]);
  });

  it('shows the sky with the water: clouds, what falls, the wind and the season', () => {
    const { sky } = createRun(cycleModel(cycle())).at(40);
    expect(sky.cloud.length).toBe(cols * rows);
    expect(sky.fall.length).toBe(cols * rows);
    expect(Math.hypot(sky.wind.x, sky.wind.y)).toBeGreaterThan(0);
    expect(sky.yearShare).toBeGreaterThan(0);
  });
});
