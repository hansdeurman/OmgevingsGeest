import { describe, expect, it } from 'vitest';
import { emptyBudget } from '../heat';
import { createHydroWorld, totalWater } from '../hydroWorld';
import { soakOf } from '../retention';
import { createRun } from '../waterRun';
import { createWaterCycle, cycleModel, cycleStep, cycleWater, defaultClimate } from '../waterCycle';

/** Sea all round, land rising to a ridge in the middle. */
const [cols, rows] = [14, 10];
const n = cols * rows;
const ground = Array.from({ length: n }, (_, i) => {
  const [c, r] = [i % cols, Math.floor(i / cols)];
  return c < 3 || c > 10 || r < 2 || r > 7 ? 0 : 1 + Math.max(0, 5 - 2 * Math.abs(c - 7));
});
const cycle = () => createWaterCycle(createHydroWorld({ cols, rows, ground, soak: (i) => soakOf(2, 1, ground[i]), soil: () => 0.1, depth: (i) => (i === 4 * cols + 5 ? 1 : 0) }));

describe('createWaterCycle', () => {
  it('starts with humid air, no clouds, and the sea where the ground is below sea level at the edge', () => {
    const c = cycle();
    expect(totalWater(c.air.vapour)).toBeGreaterThan(0);
    expect(totalWater(c.air.cloud)).toBe(0);
    expect(c.air.sea[0]).toBe(1);
    expect(c.air.sea[4 * cols + 7]).toBe(0);
  });
});

describe('cycleStep', () => {
  it('neither makes nor loses water: what the land loses fills the sea and the air', () => {
    const c = cycle();
    const start = cycleWater(c);
    for (let k = 0; k < 300; k++) cycleStep(c);
    expect(cycleWater(c)).toBeCloseTo(start, 2);
    expect(c.step).toBe(300);
  });

  it('takes in only sunlight and gives heat back to space, nothing else', () => {
    const c = cycle();
    c.budget = emptyBudget();
    for (let k = 0; k < 640; k++) cycleStep(c);
    const { sun, space, evaporating, condensing } = c.budget;
    expect(sun).toBeGreaterThan(0);
    // Over a year what came in went out again, nearly; the water's heat goes round with it.
    expect(Math.abs(sun - space) / sun).toBeLessThan(0.1);
    expect(Math.abs(evaporating - condensing) / evaporating).toBeLessThan(0.15);
  });

  it('lets the lake give water to the air', () => {
    const c = cycle();
    let rose = 0;
    for (let k = 0; k < 100; k++) {
      cycleStep(c);
      rose += c.air.evaporated[4 * cols + 5];
    }
    expect(rose).toBeGreaterThan(0.05);
  });

  it('follows its settings: more sun, a warmer world', () => {
    const warm = defaultClimate();
    warm.heat.sun *= 1.2;
    const [a, b] = [cycle(), createWaterCycle(cycle().world, { params: warm })];
    for (let k = 0; k < 300; k++) [a, b].forEach(cycleStep);
    const mean = (c: typeof a) => c.heat.air.reduce((s, t) => s + t, 0) / n;
    expect(mean(b)).toBeGreaterThan(mean(a) + 2);
  });
});

describe('cycleModel', () => {
  it('goes back to a moment and on again exactly as it went the first time', () => {
    const run = createRun(cycleModel(cycle()), Infinity, 25);
    const look = (v: ReturnType<typeof run.at>) => ({ depth: Array.from(v.depth), cloud: Array.from(v.sky.cloud), wind: Array.from(v.sky.windX), air: Array.from(v.sky.temperature) });
    const seen = [look(run.at(60)), look(run.at(130))];
    run.at(10);
    expect(look(run.at(60))).toEqual(seen[0]);
    expect(look(run.at(130))).toEqual(seen[1]);
  });

  it('shows the sky with the water: clouds, what falls, the wind, the temperatures and the season', () => {
    const { sky } = createRun(cycleModel(cycle())).at(40);
    for (const a of [sky.cloud, sky.fall, sky.windX, sky.windY, sky.temperature, sky.surface]) expect(a.length).toBe(n);
    expect(sky.yearShare).toBeGreaterThan(0.25);
  });
});
