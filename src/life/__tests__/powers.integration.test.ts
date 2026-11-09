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
  type Seen = { rain: number; t: number; land: number; plants: number; water: number };
  const seen: Partial<Record<Gift | 'none', Seen>> = {};
  let waterAtStart = 0;

  beforeAll(() => {
    const e = build(false);
    for (let k = 0; k < YEAR / 4; k++) ecoStep(e);
    const model = ecoModel(e);
    const midsummer = model.save();
    waterAtStart = cycleWater(e.cycle);
    /** From midsummer again, every time: the avatar on each spot (grazed bare), working `gift`; averaged over the spots. */
    const work = (gift: Gift | null): Seen => {
      const s: Seen = { rain: 0, t: 0, land: 0, plants: 0, water: 0 };
      for (const spot of spots) {
        model.restore(midsummer);
        Object.assign(e.avatar, centreOf(grid.cols, spot));
        e.life.food.plants[spot] = 0.1;
        if (gift) command(e, e.cycle.step, { do: 'gift', gift });
        const around = near(spot);
        for (let k = 0; k < LONG; k++) {
          ecoStep(e);
          s.rain += mean(e.cycle.air.fall, around) / spots.length;
          s.t += mean(e.cycle.temperature, around) / LONG / spots.length;
          s.land += mean(e.cycle.temperature, land) / LONG / spots.length;
        }
        s.plants += e.life.food.plants[spot] / spots.length;
        s.water = Math.max(s.water, Math.abs(cycleWater(e.cycle) - waterAtStart));
        e.commands.clear();
      }
      return s;
    };
    for (const gift of ['none', 'rain', 'sun', 'frost', 'grow'] as const) seen[gift] = work(gift === 'none' ? null : gift);
  }, 120_000);
  const change = (gift: Gift, key: 't' | 'land') => seen[gift]![key] - seen.none![key];

  it('rain: far more rain falls around it', () => {
    expect(seen.rain!.rain).toBeGreaterThan(2 * seen.none!.rain + 0.01);
  });

  it('sun and frost: warmer or colder around it, by a few degrees at most', () => {
    expect(change('sun', 't')).toBeGreaterThan(0.6);
    expect(change('sun', 't')).toBeLessThan(5);
    expect(change('frost', 't')).toBeLessThan(-0.6);
    expect(change('frost', 't')).toBeGreaterThan(-5);
  });

  it('grow: bare ground greens again far sooner', () => {
    expect(seen.grow!.plants).toBeGreaterThan(seen.none!.plants + 0.1);
  });

  it('none of them turns the whole world warmer or colder by much, nor makes or loses water', () => {
    for (const gift of ['rain', 'sun', 'frost', 'grow'] as const) {
      expect(Math.abs(change(gift, 'land')), gift).toBeLessThan(0.5);
      expect(seen[gift]!.water, gift).toBeLessThan(0.05);
    }
  });
});
