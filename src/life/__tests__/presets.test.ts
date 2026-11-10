import { describe, expect, it } from 'vitest';
import { createHydroWorld } from '../../water/hydroWorld';
import { soakOf } from '../../water/retention';
import { createWaterCycle, cycleStep, cycleWater } from '../../water/waterCycle';
import { habitatOf } from '../habitat';
import { createLife } from '../life';
import { applyPreset, PRESET_GROUPS, PRESETS, presetOf, wobbleOf, type World } from '../presets';

const [cols, rows] = [8, 6];
const n = cols * rows;
const lake = 3 * cols + 4;
/** Sea down the west, land rising east (painted half green), a lake in the middle. */
function world(): World {
  const ground = Array.from({ length: n }, (_, i) => (i % cols === 0 ? 0 : 1 + (i % cols) / 2));
  const cycle = createWaterCycle(createHydroWorld({ cols, rows, ground, soak: () => soakOf(2, 1, 2), soil: () => 0.3 }));
  for (let k = 0; k < 10; k++) cycleStep(cycle);
  cycle.world.depth[lake] = 1;
  return { cycle, life: createLife(habitatOf(cycle), new Float32Array(n).fill(0.5)) };
}
const land = [...Array(n).keys()].filter((i) => i % cols !== 0);
const every = (w: World, a: (w: World) => ArrayLike<number>, pred: (v: number, i: number) => boolean, cells = land) => cells.every((i) => pred(a(w)[i], i));

describe('PRESETS', () => {
  it('has a few of each group, each with its own id, a name, an icon and a hint', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    for (const g of PRESET_GROUPS) expect(PRESETS.filter((p) => p.group === g.id).length).toBeGreaterThanOrEqual(3);
    for (const p of PRESETS) expect([p.name, p.icon, p.hint].every(Boolean)).toBe(true);
  });

  it('gives each climate the sun and greenhouse that keep it, warmer for the warmer ones', () => {
    const suns = PRESETS.filter((p) => p.group === 'climate').map((p) => p.climate!.sun);
    expect(suns).toEqual([...suns].sort((a, b) => a - b));
  });
});

describe('applyPreset', () => {
  it('freezes the land under snow and the sea to its freezing point, taking the snow from the sea', () => {
    const w = world();
    const before = cycleWater(w.cycle);
    applyPreset(w, 'frozen', undefined, 1);
    expect(every(w, (w) => w.cycle.temperature, (t) => t < -5)).toBe(true);
    expect(every(w, (w) => w.cycle.world.snow, (s) => s > 0.1)).toBe(true);
    expect(w.cycle.heat.surface[0]).toBeCloseTo(-1.8);
    expect(cycleWater(w.cycle)).toBeCloseTo(before, 3);
  });

  it('warms a hot world and takes its snow back to the sea', () => {
    const w = world();
    applyPreset(w, 'frozen', undefined, 1);
    const before = cycleWater(w.cycle);
    applyPreset(w, 'hot', undefined, 2);
    expect(every(w, (w) => w.cycle.heat.air, (t) => t > 10)).toBe(true);
    expect(every(w, (w) => w.cycle.world.snow, (s) => s === 0)).toBe(true);
    expect(cycleWater(w.cycle)).toBeCloseTo(before, 3);
  });

  it('sets only the hexes chosen, each a little different, the same again for the same seed', () => {
    const w = world();
    const air = w.cycle.heat.air.slice();
    applyPreset(w, 'warm', [10, 11, 12], 5);
    const set = [10, 11, 12].map((i) => w.cycle.heat.air[i]);
    expect(new Set(set).size).toBe(3);
    set.forEach((t) => expect(Math.abs(t - 11)).toBeLessThanOrEqual(2.5));
    expect(w.cycle.heat.air[13]).toBe(air[13]);
    const again = world();
    applyPreset(again, 'warm', [10, 11, 12], 5);
    expect([10, 11, 12].map((i) => again.cycle.heat.air[i])).toEqual(set);
    expect(wobbleOf(10, 5)).not.toBe(wobbleOf(10, 6));
  });

  it('dries the ground and the air, but leaves the lakes, and floods the land, water from and to the sea', () => {
    const w = world();
    const before = cycleWater(w.cycle);
    applyPreset(w, 'parched', undefined, 1);
    expect(every(w, (w) => w.cycle.world.soil, (s, i) => s <= 0.15 * w.cycle.world.soak.capacity[i])).toBe(true);
    expect(w.cycle.world.depth[lake]).toBe(1);
    expect(w.cycle.world.depth[lake + 1]).toBe(0);
    applyPreset(w, 'flooded', undefined, 1);
    expect(every(w, (w) => w.cycle.world.depth, (d) => d > 0.1)).toBe(true);
    expect(cycleWater(w.cycle)).toBeCloseTo(before, 3);
  });

  it('clears the sky or fills it with storm clouds', () => {
    const w = world();
    const before = cycleWater(w.cycle);
    applyPreset(w, 'storm', undefined, 1);
    expect(every(w, (w) => w.cycle.air.cloud, (c) => c > 0.2, [...Array(n).keys()])).toBe(true);
    applyPreset(w, 'clear', undefined, 1);
    expect(every(w, (w) => w.cycle.air.cloud, (c) => c === 0, [...Array(n).keys()])).toBe(true);
    expect(cycleWater(w.cycle)).toBeCloseTo(before, 3);
  });

  it('grazes the land bare, grows it full as painted, or greens it past that', () => {
    const w = world();
    const { food } = w.life;
    applyPreset(w, 'barren', undefined, 1);
    expect(every(w, () => food.plants, (p, i) => p <= 0.15 * food.room[i])).toBe(true);
    applyPreset(w, 'meadow', undefined, 1);
    expect(every(w, () => food.plants, (p, i) => p > 0.8 * food.base[i] && food.room[i] === food.base[i])).toBe(true);
    applyPreset(w, 'lush', undefined, 1);
    expect(every(w, () => food.room, (r, i) => r > food.base[i] + 0.3)).toBe(true);
    expect(food.plants[0]).toBe(0);
  });

  it('plants dense forest below the tree line, darker and rougher ground that holds more and grows more, none in the water', () => {
    const w = world();
    const { cover, world: ground } = w.cycle;
    const [albedo, rough, base, before] = [cover.albedo.slice(), cover.rough.slice(), w.life.food.base.slice(), cycleWater(w.cycle)];
    applyPreset(w, 'dense', undefined, 1);
    const low = land.filter((i) => w.cycle.heat.height[i] <= 4.5 && i !== lake);
    expect(low.every((i) => cover.trees[i] >= 3)).toBe(true);
    expect(low.every((i) => cover.albedo[i] < albedo[i] && cover.rough[i] > rough[i] && w.life.food.base[i] >= base[i])).toBe(true);
    expect([cover.trees[0], cover.trees[lake]]).toEqual([0, 0]);
    expect(land.every((i) => ground.soil[i] <= ground.soak.capacity[i] + 1e-6)).toBe(true);
    applyPreset(w, 'open', undefined, 1);
    expect(land.every((i) => cover.trees[i] === 0)).toBe(true);
    expect(land.every((i) => ground.soil[i] <= ground.soak.capacity[i] + 1e-6)).toBe(true);
    expect(cycleWater(w.cycle)).toBeCloseTo(before, 3);
  });

  it('does nothing for a preset it does not know', () => {
    const w = world();
    const air = w.cycle.heat.air.slice();
    applyPreset(w, 'nowhere', undefined, 1);
    expect(w.cycle.heat.air).toEqual(air);
    expect(presetOf('nowhere')).toBeUndefined();
  });
});
