import { beforeAll, describe, expect, it } from 'vitest';
import { demoMap } from '../../tiles/demoMaps';
import { groundCoverOf, hydroWorldOf, plantRoomOf } from '../../tiles/mapHydro';
import { seasonOf, yearShare, YEAR } from '../../water/sun';
import { createWaterCycle, cycleWater } from '../../water/waterCycle';
import { BESTIARY, kindOf } from '../bestiary';
import { createEcosystem, ecoStep, type Ecosystem } from '../ecosystem';
import { countsOf } from '../life';

/**
 * The highlands with all their life for two years, in the closed climate:
 * measured each eighth of a year, the kinds that live on, the creatures
 * that sleep or fly south in winter, the plants through the seasons, and
 * all the water there is.
 */
const YEARS = 2;
const { grid, water } = demoMap('highlands', 1);
let e: Ecosystem;
let waterAtStart = 0;
const seen: { step: number; season: string; counts: Int32Array; asleep: number; away: number; plants: number; water: number }[] = [];
const ordinary = BESTIARY.flatMap((s, k) => (s.mystic ? [] : [k]));

beforeAll(() => {
  e = createEcosystem(createWaterCycle(hydroWorldOf(grid, 12, water), { cover: groundCoverOf(grid), seed: 1 }), plantRoomOf(grid), 1);
  waterAtStart = cycleWater(e.cycle);
  for (let k = 1; k <= YEARS * YEAR; k++) {
    ecoStep(e);
    if (k % (YEAR / 8)) continue;
    const { creatures, food } = e.life;
    seen.push({
      step: k,
      season: seasonOf(yearShare(k)),
      counts: countsOf(e.life),
      asleep: creatures.filter((c) => c.doing === 'sleep').length,
      away: creatures.filter((c) => c.doing === 'away').length,
      plants: food.plants.reduce((a, b) => a + b, 0),
      water: cycleWater(e.cycle),
    });
  }
}, 120_000);

const inSeason = (season: string) => seen.filter((s) => s.season === season);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('the highlands’ ecosystem, over two years', () => {
  it('keeps most ordinary kinds alive, none of them overrunning the land', () => {
    const last = seen[seen.length - 1].counts;
    expect(ordinary.filter((k) => last[k] > 0).length).toBeGreaterThanOrEqual(ordinary.length - 3);
    const total = ordinary.reduce((s, k) => s + last[k], 0);
    expect(total).toBeGreaterThan(80);
    expect(total).toBeLessThan(800);
  });

  it('keeps grazers, hunters and fishers: the food web holds', () => {
    const last = seen[seen.length - 1].counts;
    for (const id of ['hare', 'goat', 'otter', 'stormeel']) expect(last[kindOf(id)], id).toBeGreaterThan(0);
    expect(last[kindOf('sparkfox')] + last[kindOf('dreamowl')]).toBeGreaterThan(0);
  });

  it('puts cold-blooded creatures to sleep in winter, and sends the swallows south', () => {
    expect(mean(inSeason('winter').map((s) => s.asleep))).toBeGreaterThan(mean(inSeason('summer').map((s) => s.asleep)) + 5);
    expect(Math.max(...inSeason('winter').map((s) => s.away))).toBeGreaterThan(0);
    expect(Math.min(...inSeason('summer').map((s) => s.away))).toBe(0);
  });

  it('grows green through summer into autumn, and is grazed and frozen back by spring', () => {
    expect(mean(inSeason('autumn').map((s) => s.plants))).toBeGreaterThan(mean(inSeason('spring').map((s) => s.plants)));
  });

  it('neither makes nor loses water, whatever the creatures do to it', () => {
    for (const s of seen) expect(s.water).toBeCloseTo(waterAtStart, 0);
    expect(Math.abs(seen[seen.length - 1].water - waterAtStart) / waterAtStart).toBeLessThan(1e-5);
  });
});
