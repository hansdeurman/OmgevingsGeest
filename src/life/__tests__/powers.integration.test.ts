import { beforeAll, describe, expect, it } from 'vitest';
import { demoMap } from '../../tiles/demoMaps';
import { groundCoverOf, hydroWorldOf, plantRoomOf } from '../../tiles/mapHydro';
import { YEAR } from '../../water/sun';
import { createWaterCycle, cycleWater } from '../../water/waterCycle';
import type { Gift } from '../../player/avatar';
import { command, createEcosystem, ecoModel, ecoStep, type Ecosystem } from '../ecosystem';
import { centreOf } from '../hexSpace';

/**
 * Powers nudge the world, they do not overturn it. On the highlands: all
 * the ordinary creatures together change the climate only a little over
 * two years; each of the avatar's gifts, worked a while in midsummer,
 * changes the weather around it, clearly, and the world as a whole hardly
 * (each time from the same moment, so the weather's own chance does not
 * hide what the gift does); and no water is made or lost.
 */
const { grid, water } = demoMap('highlands', 1);
const n = grid.cols * grid.rows;
const land = [...Array(n).keys()].filter((i) => grid.elevation[i] > 0);
const mountains = land.filter((i) => grid.elevation[i] >= 5);
const lowland = land.filter((i) => grid.elevation[i] >= 1 && grid.elevation[i] < 2);
const build = (life: boolean): Ecosystem => createEcosystem(createWaterCycle(hydroWorldOf(grid, 12, water), { cover: groundCoverOf(grid), seed: 1 }), plantRoomOf(grid), 1, life);
const mean = (a: ArrayLike<number>, cells: number[]) => cells.reduce((s, i) => s + a[i], 0) / cells.length;

describe('all the ordinary creatures together, over two years', () => {
  const seen = { with: { t: 0, rain: 0 }, without: { t: 0, rain: 0 } };
  beforeAll(() => {
    for (const [name, e] of [['with', build(true)], ['without', build(false)]] as const)
      for (let k = 0; k < 2 * YEAR; k++) {
        ecoStep(e);
        seen[name].t += mean(e.cycle.temperature, land) / (2 * YEAR);
        seen[name].rain += mean(e.cycle.air.fall, mountains);
      }
  }, 120_000);

  it('hardly change the land’s temperature, or the rain on the mountains', () => {
    expect(Math.abs(seen.with.t - seen.without.t)).toBeLessThan(0.3);
    expect(Math.abs(seen.with.rain / seen.without.rain - 1)).toBeLessThan(0.15);
  });
});

describe('the avatar’s gifts, each worked a while in midsummer, on lowland spots', () => {
  /** Spots spread over the lowland, and the hexes the gifts reach around each. */
  const spots = [0.2, 0.4, 0.6, 0.8].map((q) => lowland[Math.floor(q * lowland.length)]);
  const near = (spot: number) => land.filter((i) => Math.hypot(centreOf(grid.cols, i).x - centreOf(grid.cols, spot).x, centreOf(grid.cols, i).y - centreOf(grid.cols, spot).y) <= 2.5);
  const LONG = 60;
  type Seen = { rain: number; cloud: number; wet: number; t: number; land: number; plants: number; room: number; water: number };
  const seen: Partial<Record<Gift | 'none', Seen>> = {};
  const sandy = {} as Record<'none' | 'grow', { room: number; plants: number }>;
  let waterAtStart = 0;

  beforeAll(() => {
    const e = build(false);
    for (let k = 0; k < YEAR / 4; k++) ecoStep(e);
    const model = ecoModel(e);
    const midsummer = model.save();
    waterAtStart = cycleWater(e.cycle);
    /** From midsummer again, every time: the avatar on each spot (grazed bare, a cloud over it drawn from the sea), working `gift`; averaged over the spots. */
    const work = (gift: Gift | null): Seen => {
      const s: Seen = { rain: 0, cloud: 0, wet: 0, t: 0, land: 0, plants: 0, room: 0, water: 0 };
      for (const spot of spots) {
        model.restore(midsummer);
        Object.assign(e.avatar, centreOf(grid.cols, spot));
        e.life.food.plants[spot] = 0.1;
        const around = near(spot);
        for (const i of around) [e.cycle.sea, e.cycle.air.cloud[i]] = [e.cycle.sea - (0.1 - e.cycle.air.cloud[i]), 0.1];
        if (gift) command(e, e.cycle.step, { do: 'gift', gift });
        for (let k = 0; k < LONG; k++) {
          ecoStep(e);
          s.rain += mean(e.cycle.air.fall, around) / spots.length;
          s.cloud += mean(e.cycle.air.cloud, around) / LONG / spots.length;
          s.t += mean(e.cycle.temperature, around) / LONG / spots.length;
          s.land += mean(e.cycle.temperature, land) / LONG / spots.length;
        }
        s.wet += around.reduce((sum, i) => sum + e.cycle.world.soil[i] + e.cycle.world.depth[i], 0) / around.length / spots.length;
        s.plants += e.life.food.plants[spot] / spots.length;
        s.room += e.life.food.room[spot] / spots.length;
        s.water = Math.max(s.water, Math.abs(cycleWater(e.cycle) - waterAtStart));
        e.commands.clear();
      }
      return s;
    };
    for (const gift of ['none', 'rain', 'sun', 'frost', 'grow'] as const) seen[gift] = work(gift === 'none' ? null : gift);
    /** Sandy lowland: little grows there, as the map is painted. */
    const sand = lowland.filter((i) => e.life.food.base[i] < 0.45).slice(0, 4);
    for (const gift of ['none', 'grow'] as const) {
      sandy[gift] = { room: 0, plants: 0 };
      for (const spot of sand) {
        model.restore(midsummer);
        Object.assign(e.avatar, centreOf(grid.cols, spot));
        if (gift === 'grow') command(e, e.cycle.step, { do: 'gift', gift });
        for (let k = 0; k < 2 * LONG; k++) ecoStep(e);
        [sandy[gift].room, sandy[gift].plants] = [sandy[gift].room + e.life.food.room[spot] / sand.length, sandy[gift].plants + e.life.food.plants[spot] / sand.length];
        e.commands.clear();
      }
    }
  }, 120_000);
  const change = (gift: Gift, key: 't' | 'land') => seen[gift]![key] - seen.none![key];

  it('rain: thick clouds stay over it, far more rain falls around it, and the ground gets wetter', () => {
    expect(seen.rain!.cloud).toBeGreaterThan(2 * seen.none!.cloud);
    expect(seen.rain!.rain).toBeGreaterThan(5 * seen.none!.rain);
    expect(seen.rain!.wet).toBeGreaterThan(seen.none!.wet + 0.05);
  });

  it('sun: clears the clouds over it, and dries the ground', () => {
    expect(seen.sun!.cloud).toBeLessThan(0.5 * seen.none!.cloud);
    expect(seen.sun!.wet).toBeLessThan(seen.none!.wet - 0.1);
  });

  it('sun and frost: warmer or colder around it, by a few degrees at most', () => {
    expect(change('sun', 't')).toBeGreaterThan(0.6);
    expect(change('sun', 't')).toBeLessThan(5);
    expect(change('frost', 't')).toBeLessThan(-0.6);
    expect(change('frost', 't')).toBeGreaterThan(-5);
  });

  it('grow: bare ground greens again far sooner', () => {
    expect(seen.grow!.plants).toBeGreaterThan(seen.none!.plants + 0.2);
  });

  it('grow: sandy ground turns green, more than it ever was', () => {
    expect(sandy.grow.room).toBeGreaterThan(sandy.none.room + 0.2);
    expect(sandy.grow.plants).toBeGreaterThan(sandy.none.plants + 0.2);
  });

  it('none of them turns the whole world warmer or colder by much, nor makes or loses water', () => {
    for (const gift of ['rain', 'sun', 'frost', 'grow'] as const) {
      expect(Math.abs(change(gift, 'land')), gift).toBeLessThan(0.6);
      expect(seen[gift]!.water, gift).toBeLessThan(0.05);
    }
  });
});
