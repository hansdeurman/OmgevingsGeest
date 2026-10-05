import { describe, expect, it } from 'vitest';
import { demoMap } from '../../tiles/demoMaps';
import { groundCoverOf, hydroWorldOf } from '../../tiles/mapHydro';
import { seasonOf, yearShare, YEAR } from '../sun';
import { createWaterCycle, cycleStep, cycleWater, type WaterCycle } from '../waterCycle';

/**
 * The highlands as one closed world for four years, the sun the only thing
 * from outside. Measured per eighth of a year: temperatures, where rain and
 * snow fall, the snow on the peaks, the rivers, the lakes' evaporation, the
 * wind along the coast, and all the water there is.
 */
const YEARS = 4;
const { grid, water } = demoMap('highlands', 1);
const world = hydroWorldOf(grid, 12, water);
const c: WaterCycle = createWaterCycle(world, { cover: groundCoverOf(grid), seed: 1 });
const { n, cols } = world.topo;
const all = Array.from({ length: n }, (_, i) => i);
const land = all.filter((i) => !world.sink[i]);
const sea = all.filter((i) => c.air.sea[i]);
const where = (test: (h: number) => boolean) => land.filter((i) => test(world.ground[i]));
const [lowland, mountains, peaks] = [where((h) => h < 2), where((h) => h >= 5), where((h) => h >= 7)];
const lakes = land.filter((i) => (water?.[i] ?? 0) > 0);
const mean = (a: ArrayLike<number>, cells: number[]) => cells.reduce((s, i) => s + a[i], 0) / cells.length;
const pos = (i: number) => ({ x: (i % cols) + (Math.floor(i / cols) & 1) / 2, y: (Math.floor(i / cols) * Math.sqrt(3)) / 2 });
const middle = land.reduce((m, i) => ({ x: m.x + pos(i).x / land.length, y: m.y + pos(i).y / land.length }), { x: 0, y: 0 });
const coast = land.filter((i) => world.ground[i] < 2);
/** How hard the wind blows onto the land, along the coast (below 0: off it). */
const onshore = () =>
  mean(
    Float32Array.from(all, (i) => {
      const [p, d] = [pos(i), Math.hypot(middle.x - pos(i).x, middle.y - pos(i).y) || 1];
      return (c.wind.x[i] * (middle.x - p.x) + c.wind.y[i] * (middle.y - p.y)) / d;
    }),
    coast,
  );

const startWater = cycleWater(c);
const fell = new Float64Array(n);
let lakeGave = 0;
const moments: { season: string; year: number; sea: number; lowland: number; peaks: number; peakSnow: number; soil: number; flow: number; cover: number; onshore: number }[] = [];
for (let k = 0; k < YEARS * YEAR; k++) {
  cycleStep(c);
  if (k >= YEAR) c.air.fall.forEach((f, i) => (fell[i] += f));
  lakeGave += lakes.reduce((s, i) => s + c.air.evaporated[i], 0);
  if ((k + 1) % (YEAR / 8)) continue;
  moments.push({
    season: seasonOf(yearShare(k + 1)),
    year: Math.floor((k + 1) / YEAR),
    sea: mean(c.heat.surface, sea),
    lowland: mean(c.temperature, lowland),
    peaks: mean(c.temperature, peaks),
    peakSnow: mean(world.snow, peaks),
    soil: land.reduce((s, i) => s + world.soil[i], 0),
    flow: Math.max(...land.map((i) => world.channels.flow[i])),
    cover: all.filter((i) => c.air.cloud[i] > 0.01).length / n,
    onshore: onshore(),
  });
}
const after = moments.filter((m) => m.year >= 1);
const at = (season: string) => after.filter((m) => m.season === season);
const avg = (ms: typeof moments, f: (m: (typeof moments)[0]) => number) => ms.reduce((s, m) => s + f(m), 0) / ms.length;

describe('the highlands as one closed world', () => {
  it('keeps all its water: none made, none lost, over four years', () => {
    expect(Math.abs(cycleWater(c) - startWater)).toBeLessThan(1e-3);
  });

  it('is a cool sea climate: mild summers, winters near freezing, the sea milder and later than the land, the peaks far colder', () => {
    const summer = avg(at('summer'), (m) => m.lowland);
    const winter = avg(at('winter'), (m) => m.lowland);
    expect(summer).toBeGreaterThan(5);
    expect(summer).toBeLessThan(20);
    expect(winter).toBeGreaterThan(-6);
    expect(winter).toBeLessThan(6);
    const swing = (f: (m: (typeof moments)[0]) => number) => Math.max(...after.map(f)) - Math.min(...after.map(f));
    expect(swing((m) => m.sea)).toBeLessThan(swing((m) => m.lowland) + 1);
    expect(avg(at('autumn'), (m) => m.sea)).toBeGreaterThan(avg(at('spring'), (m) => m.sea));
    expect(avg(after, (m) => m.peaks)).toBeLessThan(avg(after, (m) => m.lowland) - 6);
  });

  it('brings rain and snow to the mountains: at least twice as much falls on them per hex as on the lowland', () => {
    expect(mean(fell, mountains)).toBeGreaterThan(2 * mean(fell, lowland));
  });

  it('lays snow on the peaks every winter that melts down in summer and autumn, never quite all of it', () => {
    for (let y = 1; y < YEARS; y++) {
      const year = moments.filter((m) => m.year === y).map((m) => m.peakSnow);
      expect(Math.max(...year) - Math.min(...year)).toBeGreaterThan(0.2);
    }
    expect(Math.min(...after.map((m) => m.peakSnow))).toBeGreaterThan(0.03);
  });

  it('runs its rivers through the year, hardest after summer and autumn rain and melt', () => {
    expect(avg([...at('summer'), ...at('autumn')], (m) => m.flow)).toBeGreaterThan(avg(at('spring'), (m) => m.flow));
    expect(Math.min(...after.map((m) => m.flow))).toBeGreaterThan(0.01);
  });

  it('lets its lakes give water to the air, a real source of its humidity', () => {
    expect(lakeGave / (YEARS * YEAR) / lakes.length).toBeGreaterThan(0.001);
  });

  it('blows onto the land in summer, when the land is warmer than the sea, and less or off it in winter', () => {
    expect(avg(at('summer'), (m) => m.onshore)).toBeGreaterThan(0.03);
    expect(avg(at('winter'), (m) => m.onshore)).toBeLessThan(avg(at('summer'), (m) => m.onshore) / 2);
  });

  it('neither dries out nor floods, year after year', () => {
    const soil = (y: number) => moments.filter((m) => m.year === y && m.season === 'summer')[0].soil;
    expect(soil(YEARS - 1)).toBeGreaterThan(0.7 * soil(1));
    expect(soil(YEARS - 1)).toBeLessThan(1.4 * soil(1));
  });

  it('always has some clouds, never a sky full', () => {
    for (const m of after) {
      expect(m.cover).toBeGreaterThan(0.01);
      expect(m.cover).toBeLessThan(0.8);
    }
  });
});
