import { describe, expect, it } from 'vitest';
import { createHydroWorld } from '../../water/hydroWorld';
import { soakOf } from '../../water/retention';
import { createWaterCycle, cycleWater } from '../../water/waterCycle';
import { createRun } from '../../water/waterRun';
import { kindOf } from '../bestiary';
import { command, createEcosystem, ecoModel, ecoStep, forgetCommands } from '../ecosystem';
import { hexAt } from '../hexSpace';

/** Sea all round, a meadow rising to a ridge in the middle, a lake at its foot. */
const [cols, rows] = [16, 12];
const n = cols * rows;
const ground = Array.from({ length: n }, (_, i) => {
  const [c, r] = [i % cols, Math.floor(i / cols)];
  return c < 2 || c > 13 || r < 2 || r > 9 ? 0 : 1 + Math.max(0, 4 - Math.abs(c - 8));
});
const eco = (seed = 1) => {
  const world = createHydroWorld({ cols, rows, ground, soak: (i) => soakOf(3, 1, ground[i]), soil: () => 0.1, depth: (i) => (i === 5 * cols + 4 ? 1 : 0) });
  return createEcosystem(createWaterCycle(world, { seed }), new Float32Array(n).fill(0.8), seed);
};

describe('createEcosystem', () => {
  it('starts the world with its creatures, plants and fish', () => {
    const e = eco();
    expect(e.life.creatures.length).toBeGreaterThan(30);
    expect(e.life.food.plants.some((p) => p > 0)).toBe(true);
    expect(e.life.food.fish[0]).toBeGreaterThan(0);
  });
});

describe('ecoStep', () => {
  it('steps the world and its life together, making and losing no water', () => {
    const e = eco();
    const water = cycleWater(e.cycle);
    for (let k = 0; k < 200; k++) ecoStep(e);
    expect(e.cycle.step).toBe(200);
    expect(cycleWater(e.cycle)).toBeCloseTo(water, 2);
    expect(e.life.creatures.length).toBeGreaterThan(20);
  });

  it('lets creatures in at the step they were sent for', () => {
    const e = eco();
    const eel = kindOf('stormeel');
    command(e, 3, { do: 'release', kind: eel, count: 4 });
    const eels = () => e.life.creatures.filter((c) => c.kind === eel).length;
    const before = eels();
    for (let k = 0; k < 3; k++) ecoStep(e);
    expect(eels()).toBeLessThanOrEqual(before);
    ecoStep(e);
    expect(eels()).toBeGreaterThanOrEqual(before + 3);
  });
});

describe('the avatar', () => {
  it('walks where it is sent, at the step it is sent', () => {
    const e = eco();
    command(e, 2, { do: 'go', x: 2, y: 2 });
    const start = { ...e.avatar };
    for (let k = 0; k < 2; k++) ecoStep(e);
    expect([e.avatar.x, e.avatar.y]).toEqual([start.x, start.y]);
    for (let k = 0; k < 60; k++) ecoStep(e);
    expect([e.avatar.x, e.avatar.y]).toEqual([2, 2]);
  });

  it('makes it rain where it stands with its gift, the water all accounted for, and spends its spirit', () => {
    const e = eco();
    for (let k = 0; k < 30; k++) ecoStep(e);
    const water = cycleWater(e.cycle);
    const at = hexAt(cols, rows, e.avatar.x, e.avatar.y);
    command(e, e.cycle.step, { do: 'gift', gift: 'rain' });
    let fell = 0;
    for (let k = 0; k < 40; k++) {
      ecoStep(e);
      fell += e.cycle.air.fall[at];
    }
    expect(fell).toBeGreaterThan(0.05);
    expect(e.avatar.spirit).toBeLessThan(1);
    expect(cycleWater(e.cycle)).toBeCloseTo(water, 2);
    command(e, e.cycle.step, { do: 'gift', gift: null });
    ecoStep(e);
    expect(e.avatar.gift).toBeNull();
  });

  it('forgets the commands for after a moment, to play on anew from there', () => {
    const e = eco();
    command(e, 5, { do: 'go', x: 2, y: 2 });
    command(e, 9, { do: 'go', x: 4, y: 2 });
    forgetCommands(e, 6);
    expect([...e.commands.keys()]).toEqual([5]);
  });
});

describe('ecoModel', () => {
  it('goes back to a moment and on again exactly as it went, releases and all', () => {
    const e = eco(2);
    command(e, 50, { do: 'release', kind: kindOf('hare'), count: 5 });
    command(e, 20, { do: 'go', x: 3, y: 3 });
    command(e, 30, { do: 'gift', gift: 'rain' });
    command(e, 40, { do: 'preset', preset: 'storm', seed: 3 });
    command(e, 60, { do: 'preset', preset: 'lush', cells: [5, 6, 7], seed: 4 });
    const run = createRun(ecoModel(e), Infinity, 25);
    const look = (step: number) => {
      const v = run.at(step);
      return JSON.stringify({ c: v.life.creatures, d: Array.from(v.depth), w: Array.from(v.sky.windX), p: Array.from(v.life.plants), a: v.avatar });
    };
    const seen = [look(70), look(120)];
    run.at(10);
    expect(look(70)).toBe(seen[0]);
    expect(look(120)).toBe(seen[1]);
  });

  it('puts the world in a preset state as the step it was given for begins', () => {
    const e = eco();
    command(e, 3, { do: 'preset', preset: 'frozen', seed: 1 });
    for (let k = 0; k < 3; k++) ecoStep(e);
    expect(e.cycle.world.snow.some((s) => s > 0.1)).toBe(false);
    ecoStep(e);
    expect(e.cycle.world.snow.filter((s) => s > 0.1).length).toBeGreaterThan(n / 3);
  });

  it('shows the life of the moment: creatures, how many of each kind, plants', () => {
    const v = createRun(ecoModel(eco())).at(5);
    expect(v.life.creatures.length).toBeGreaterThan(0);
    expect(v.life.creatures[0]).toHaveProperty('doing');
    expect(v.life.counts.reduce((a, b) => a + b, 0)).toBe(v.life.creatures.length);
    expect(v.life.plants).toHaveLength(n);
  });
});
