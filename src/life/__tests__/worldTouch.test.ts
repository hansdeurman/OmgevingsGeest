import { describe, expect, it } from 'vitest';
import { createHydroWorld } from '../../water/hydroWorld';
import { soakOf } from '../../water/retention';
import { createWaterCycle, cycleStep, cycleWater, type WaterCycle } from '../../water/waterCycle';
import { MOST_WIND } from '../../water/wind';
import { createInfluence } from '../powers';
import { touchWorld } from '../worldTouch';

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

describe('touchWorld', () => {
  it('warms and cools the air and ground where asked', () => {
    const c = cycle();
    const f = createInfluence(n);
    [f.heat[8], f.heat[9]] = [2, -2];
    const [air, ground] = [c.heat.air.slice(), c.heat.surface.slice()];
    touchWorld(c, f);
    expect(c.heat.air[8] - air[8]).toBeCloseTo(2);
    expect(c.heat.air[9] - air[9]).toBeCloseTo(-2);
    expect(c.heat.surface[8]).toBeGreaterThan(ground[8]);
  });

  it('pushes the wind, stills it, and never past the strongest wind there is', () => {
    const c = cycle();
    const f = createInfluence(n);
    [f.gustX[8], f.still[9], f.gustX[10]] = [0.1, 1, 5];
    const x = c.wind.x.slice();
    touchWorld(c, f);
    expect(c.wind.x[8] - x[8]).toBeCloseTo(0.1);
    expect([c.wind.x[9], c.wind.y[9]]).toEqual([0, 0]);
    expect(Math.hypot(c.wind.x[10], c.wind.y[10])).toBeCloseTo(MOST_WIND);
  });

  it('moves water, never making or losing any: rain from clouds, clouds thinned, mist from lakes and the sea, ice', () => {
    const c = cycle();
    const before = cycleWater(c);
    const f = createInfluence(n);
    [f.rain[8], f.thin[9], f.mist[lake], f.mist[0], f.mist[7], f.freeze[lake]] = [0.5, 0.5, 0.2, 0.3, 5, 0.25];
    const [cloud, fall, depth, snow, sea] = [c.air.cloud.slice(), c.air.fall.slice(), c.world.depth[lake], c.world.snow[lake], c.sea];
    touchWorld(c, f);
    expect(c.air.cloud[8]).toBeCloseTo(cloud[8] / 2);
    expect(c.air.fall[8] - fall[8]).toBeCloseTo(cloud[8] / 2);
    expect(c.air.cloud[9]).toBeCloseTo(cloud[9] / 2);
    expect(c.world.depth[lake]).toBeLessThan(depth - 0.2);
    expect(c.world.snow[lake]).toBeGreaterThan(snow);
    expect(c.sea).toBeCloseTo(sea - 0.3, 5);
    expect(c.air.rise[0]).toBeGreaterThan(0.29);
    expect(cycleWater(c)).toBeCloseTo(before, 4);
    for (let k = 0; k < 30; k++) {
      touchWorld(c, f);
      cycleStep(c);
    }
    expect(cycleWater(c)).toBeCloseTo(before, 3);
  });
});
