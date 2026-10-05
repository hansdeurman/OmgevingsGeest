import { describe, expect, it } from 'vitest';
import { demoMap } from '../../tiles/demoMaps';
import { hydroWorldOf } from '../../tiles/mapHydro';
import { createClimate, seasonOf, YEAR } from '../climate';
import { createWaterCycle, cycleStep, type WaterCycle } from '../waterCycle';

/**
 * The water cycle on the highlands: three years, the climate alone deciding
 * the weather. Measured per season: where rain and snow fall, the snow on
 * the heights, the rivers and how much water the land holds.
 */
const YEARS = 3;
const { grid } = demoMap('highlands', 1);
const world = hydroWorldOf(grid);
const c: WaterCycle = createWaterCycle(world, createClimate(1));
const { n } = world.topo;
const land = Array.from({ length: n }, (_, i) => i).filter((i) => !world.sink[i]);
const where = (test: (h: number) => boolean) => land.filter((i) => test(world.ground[i]));
const [lowland, mountains, peaks] = [where((h) => h < 2), where((h) => h >= 5), where((h) => h >= 7)];
const mean = (a: ArrayLike<number>, cells: number[]) => cells.reduce((s, i) => s + a[i], 0) / cells.length;

const fell = new Float64Array(n);
/** The rivers as they run at the end of the second summer. */
let summerRivers = { down: new Int32Array(0), bed: new Float32Array(0) };
const moments: { season: string; year: number; peakSnow: number; soil: number; flow: number; cover: number }[] = [];
for (let k = 0; k < YEARS * YEAR; k++) {
  cycleStep(c);
  c.air.fall.forEach((f, i) => (fell[i] += f));
  if ((k + 1) % (YEAR / 8)) continue;
  const now = c.climate.at(k + 1);
  if (k + 1 === Math.round(YEAR * 1.5)) summerRivers = { down: world.channels.down.slice(), bed: world.channels.bed.slice() };
  moments.push({
    season: seasonOf(now.yearShare),
    year: Math.floor((k + 1) / YEAR),
    peakSnow: mean(world.snow, peaks),
    soil: land.reduce((s, i) => s + world.soil[i], 0),
    flow: Math.max(...land.map((i) => world.channels.flow[i])),
    cover: Array.from(c.air.cloud).filter((v) => v > 0.01).length / n,
  });
}
const at = (season: string, year: number) => moments.filter((m) => m.season === season && m.year === year);

describe('the water cycle on the highlands', () => {
  it('brings rain and snow to the mountains: far more falls on them than on the lowland', () => {
    expect(mean(fell, mountains)).toBeGreaterThan(5 * mean(fell, lowland));
  });

  it('lays snow on the peaks in winter that melts in summer, while the glaciers last', () => {
    for (let y = 1; y < YEARS; y++) {
      const [winter, summer] = [at('winter', y).at(-1)!, at('summer', y).at(-1)!];
      expect(winter.peakSnow).toBeGreaterThan(summer.peakSnow);
      expect(summer.peakSnow).toBeGreaterThan(0.2);
    }
  });

  it('runs its rivers with the melt and the rain from spring on, frozen still in deep winter', () => {
    const peak = (season: string) => Math.max(...moments.filter((m) => m.season === season && m.year > 0).map((m) => m.flow));
    expect(peak('summer')).toBeGreaterThan(5 * peak('winter'));
    expect(peak('summer')).toBeGreaterThan(0.1);
  });

  it('feeds its rivers from the mountains: where they gather their water, most falls on the heights, twice as much per hex as below', () => {
    const { down, bed } = summerRivers;
    const into = (j: number) => land.filter((i) => down[i] === j);
    const mouths = land.filter((i) => bed[i] >= 0.04 && (down[i] < 0 || world.sink[down[i]]));
    expect(mouths.length).toBeGreaterThan(1);
    const catchments = mouths.flatMap((mouth) => {
      const cells = [mouth];
      for (let k = 0; k < cells.length; k++) cells.push(...into(cells[k]));
      return cells;
    });
    const total = catchments.reduce((s, i) => s + fell[i], 0);
    const heights = catchments.filter((i) => world.ground[i] >= 3);
    const high = heights.reduce((s, i) => s + fell[i], 0);
    expect(high / total).toBeGreaterThan(0.5);
    expect(high / heights.length).toBeGreaterThan((1.8 * (total - high)) / (catchments.length - heights.length));
  });

  it('neither dries the land out nor floods it, year after year', () => {
    const soil = (y: number) => at('spring', y).at(-1)!.soil;
    expect(soil(YEARS - 1)).toBeGreaterThan(0.75 * soil(1));
    expect(soil(YEARS - 1)).toBeLessThan(1.25 * soil(1));
  });

  it('keeps clouds in the sky, never none and never all over', () => {
    for (const m of moments) {
      expect(m.cover).toBeGreaterThan(0.05);
      expect(m.cover).toBeLessThan(0.75);
    }
  });
});
