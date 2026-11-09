import { describe, expect, it } from 'vitest';
import { saturation } from '../../water/atmosphere';
import { createHydroWorld } from '../../water/hydroWorld';
import { soakOf } from '../../water/retention';
import { createWaterCycle, cycleStep, cycleWater, type WaterCycle } from '../../water/waterCycle';
import { MOST_WIND } from '../../water/wind';
import { createInfluence } from '../powers';
import { soft } from '../../math/scalar';
import { LIMITS, touchWorld } from '../worldTouch';

const [cols, rows] = [6, 5];
const n = cols * rows;
const lake = 2 * cols + 3;
/** Sea down the west, land rising east, a lake (filled after a few steps) in the middle. */
function cycle(): WaterCycle {
  const ground = Array.from({ length: n }, (_, i) => (i % cols === 0 ? 0 : 1 + (i % cols)));
  const c = createWaterCycle(createHydroWorld({ cols, rows, ground, soak: () => soakOf(2, 1, 2), soil: () => 0.05 }));
  for (let k = 0; k < 20; k++) cycleStep(c);
  c.air.cloud.fill(0.1);
  c.world.depth[lake] = 1;
  return c;
}

describe('soft', () => {
  it('passes small nudges as they are, and never lets them past the most', () => {
    expect(soft(0.01, 1)).toBeCloseTo(0.01, 4);
    expect(soft(100, 1)).toBeLessThanOrEqual(1);
    expect(soft(-100, 1)).toBeGreaterThanOrEqual(-1);
    expect(soft(2, 1)).toBeGreaterThan(soft(1, 1));
  });
});

describe('touchWorld', () => {
  it('warms and cools the air and ground where asked, by a nudge however much is asked', () => {
    const c = cycle();
    const f = createInfluence(n);
    [f.heat[8], f.heat[9], f.heat[10]] = [0.02, -0.02, 50];
    const [air, ground] = [c.heat.air.slice(), c.heat.surface.slice()];
    touchWorld(c, f);
    expect(c.heat.air[8] - air[8]).toBeCloseTo(0.02, 3);
    expect(c.heat.air[9] - air[9]).toBeCloseTo(-0.02, 3);
    expect(c.heat.air[10] - air[10]).toBeCloseTo(LIMITS.heat, 3);
    expect(c.heat.surface[8]).toBeGreaterThan(ground[8]);
  });

  it('pushes the wind, stills it, and never past the strongest wind there is', () => {
    const c = cycle();
    const f = createInfluence(n);
    [f.gustX[8], f.still[9], f.gustX[10]] = [0.01, 5, 5];
    c.wind.x[10] = MOST_WIND;
    const x = c.wind.x.slice();
    touchWorld(c, f);
    expect(c.wind.x[8] - x[8]).toBeCloseTo(0.01, 3);
    expect(Math.abs(c.wind.x[9])).toBeLessThan(Math.abs(x[9]) * (1 - LIMITS.still) + 1e-6);
    expect(Math.hypot(c.wind.x[10], c.wind.y[10])).toBeLessThanOrEqual(MOST_WIND + 1e-6);
  });

  it('moves water, never making or losing any: rain from clouds, clouds thinned, mist from lakes and the sea, ice', () => {
    const c = cycle();
    c.air.sea[0] && (c.sea += c.air.vapour[0]);
    c.air.vapour[0] = 0;
    const before = cycleWater(c);
    const f = createInfluence(n);
    [f.rain[8], f.thin[9], f.mist[lake], f.mist[0], f.freeze[lake]] = [0.3, 0.05, 0.005, 0.005, 0.25];
    c.temperature[lake] = -6;
    const [cloud, fall, depth, snow, sea] = [c.air.cloud.slice(), c.air.fall.slice(), c.world.depth[lake], c.world.snow[lake], c.sea];
    touchWorld(c, f);
    const rained = cloud[8] * soft(0.3, LIMITS.share);
    expect(c.air.cloud[8]).toBeCloseTo(cloud[8] - rained);
    expect(c.air.fall[8] - fall[8]).toBeCloseTo(rained);
    expect(c.air.cloud[9]).toBeLessThan(cloud[9]);
    expect(c.world.depth[lake]).toBeLessThan(depth - 0.1);
    expect(c.world.snow[lake]).toBeGreaterThan(snow + 0.1);
    expect(c.sea).toBeLessThan(sea);
    expect(c.air.rise[0]).toBeGreaterThan(0);
    expect(cycleWater(c)).toBeCloseTo(before, 4);
    for (let k = 0; k < 30; k++) {
      touchWorld(c, f);
      cycleStep(c);
    }
    expect(cycleWater(c)).toBeCloseTo(before, 3);
  });

  it('gathers the land’s water into cloud where rain is called, under a clear sky too, leaving the air as humid as it was', () => {
    const c = cycle();
    c.air.cloud.fill(0);
    const before = cycleWater(c);
    const f = createInfluence(n);
    f.gather[lake] = 0.01;
    const [vapour, depth] = [c.air.vapour[lake], c.world.depth[lake]];
    touchWorld(c, f);
    expect(c.air.cloud[lake]).toBeCloseTo(soft(0.01, LIMITS.mist), 5);
    expect(c.world.depth[lake]).toBeCloseTo(depth - soft(0.01, LIMITS.mist), 5);
    expect(c.air.vapour[lake]).toBe(vapour);
    expect(cycleWater(c)).toBeCloseTo(before, 5);
  });

  it('lifts no more water than the air can still hold, and freezes less in the warm', () => {
    const c = cycle();
    const f = createInfluence(n);
    [f.mist[0], f.freeze[lake]] = [5, 1];
    c.temperature[lake] = 15;
    c.air.vapour[0] = c.params.air.humidity * saturation(c.temperature[0]) - 0.001;
    const [sea, snow] = [c.sea, c.world.snow[lake]];
    touchWorld(c, f);
    expect(sea - c.sea).toBeLessThanOrEqual(0.001 + 1e-6);
    const frozeWarm = c.world.snow[lake] - snow;
    expect(frozeWarm).toBeGreaterThan(0);
    const cold = cycle();
    cold.temperature[lake] = -10;
    const before = cold.world.snow[lake];
    touchWorld(cold, f);
    expect(cold.world.snow[lake] - before).toBeGreaterThan(2 * frozeWarm);
  });
});
