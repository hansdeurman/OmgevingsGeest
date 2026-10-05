import { describe, expect, it } from 'vitest';
import { LAPSE } from '../../water/retention';
import { DEFAULT_WEATHER, lakeWeather, lakeArt, lakeState, placeholderLakeKit, wallStyle } from '../highLakes';
import { createPlaceholderTextures } from '../placeholderTextures';
import { HIGH_LAKE_FROM, lakeShapes } from '../shores';
import { MAX_ELEVATION } from '../levels';

const SIZE = 20;
const kit = placeholderLakeKit(SIZE);
const ground = createPlaceholderTextures(16);

describe('wallStyle', () => {
  it('grows moss on foothill lakes, bare rock higher up and snow on the highest', () => {
    expect(wallStyle(HIGH_LAKE_FROM)).toBe('mossy');
    expect(wallStyle(5)).toBe('grey');
    expect(wallStyle(MAX_ELEVATION - 1)).toBe('snowy');
  });
});

describe('lakeState', () => {
  /** A small lake at `level`, highest at `top`. */
  const lake = (level: number, top = level) => ({ ...lakeShapes(Float32Array.from([level, level, level, level]), 2, 2)[0], level, top });
  const outlet = { x: 5, y: 9 };

  it('is colder high up and warmer in summer, in the given wind', () => {
    expect(lakeState(lake(6.5), DEFAULT_WEATHER).temperature).toBeLessThan(lakeState(lake(3), DEFAULT_WEATHER).temperature);
    expect(lakeState(lake(5), { ...DEFAULT_WEATHER, warmth: 1 }).temperature).toBeGreaterThan(lakeState(lake(5), DEFAULT_WEATHER).temperature);
    expect(lakeState(lake(5), DEFAULT_WEATHER).wind).toBe(DEFAULT_WEATHER.wind);
  });

  it('is as warm as the simulated air says, colder the higher it lies, frozen in a freezing winter', () => {
    const summer = { ...DEFAULT_WEATHER, air: 14 };
    expect(lakeState(lake(6.5), summer).temperature).toBeLessThan(lakeState(lake(3), summer).temperature);
    expect(lakeState(lake(3), { ...summer, air: -4 }).temperature).toBe(0);
    expect(lakeState(lake(3), { ...summer, warmth: -1 }).temperature).toBe(lakeState(lake(3), summer).temperature);
  });

  it('pours out where its water really leaves it, as much as leaves, and not for a trickle', () => {
    const pouring = lakeState(lake(5), DEFAULT_WEATHER, { amount: 0.05, at: outlet });
    expect(pouring.outlet).toBe(outlet);
    expect(pouring.outflow).toBe(0.05);
    expect(lakeState(lake(5), DEFAULT_WEATHER, { amount: 0.001, at: outlet }).outlet).toBeUndefined();
    expect(lakeState(lake(5), DEFAULT_WEATHER).outlet).toBeUndefined();
  });

  it('spills over its whole rim only when a great deal leaves it, harder the more', () => {
    expect(lakeState(lake(5), DEFAULT_WEATHER, { amount: 0.1, at: outlet }).spill).toBe(0);
    const some = lakeState(lake(5), DEFAULT_WEATHER, { amount: 0.5, at: outlet }).spill;
    expect(some).toBeGreaterThan(0);
    expect(lakeState(lake(5), DEFAULT_WEATHER, { amount: 0.9, at: outlet }).spill).toBeGreaterThan(some);
  });
});

describe('lakeWeather', () => {
  const sky = { temperature: Float32Array.of(2.6, 0.9, 20), windX: Float32Array.of(0.2, 0.2, -1), windY: Float32Array.of(0, 0.02, 0) };
  const heights = [3, 4, 0];

  it('takes the air over the lakes, brought to sea level, and their wind, rounded', () => {
    const w = lakeWeather(sky, heights, [0, 1]);
    expect(w.air).toBe(3 * Math.round((2.6 + LAPSE * 3 + 0.9 + LAPSE * 4) / 2 / 3));
    expect(w.wind.strength).toBeCloseTo(0.5);
    expect(w.wind.direction).toBeCloseTo(0);
  });

  it('keeps the usual weather where there are no lakes', () => {
    expect(lakeWeather(sky, heights, [])).toBe(DEFAULT_WEATHER);
  });
});

describe('lakeArt', () => {
  it('rocks each lake in the style of its height, with snow on the rim of the highest', () => {
    expect(lakeArt(kit, 3, ground).wall).toBe(kit.walls.mossy);
    expect(lakeArt(kit, 7, ground).wall).toBe(kit.walls.snowy);
    expect(lakeArt(kit, 7, ground).rim).toBe(ground.snow[0]);
    expect(lakeArt(kit, 5, ground).rim).toBe(ground.rock[0]);
  });
});
