import { describe, expect, it } from 'vitest';
import { DEFAULT_WEATHER, lakeArt, lakeState, placeholderLakeKit, wallStyle } from '../highLakes';
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

  it('pours out of its outlet only once it has risen to its overflow level', () => {
    expect(lakeState(lake(5), DEFAULT_WEATHER, { full: 5, outlet }).outlet).toBe(outlet);
    expect(lakeState(lake(4.5), DEFAULT_WEATHER, { full: 5, outlet }).outlet).toBeUndefined();
    expect(lakeState(lake(5), DEFAULT_WEATHER).outlet).toBeUndefined();
  });

  it('spills over its near rim when it stands well above its overflow level, harder the higher', () => {
    expect(lakeState(lake(5.05), DEFAULT_WEATHER, { full: 5, outlet }).spill).toBe(0);
    const some = lakeState(lake(5, 5.4), DEFAULT_WEATHER, { full: 5, outlet }).spill;
    expect(some).toBeGreaterThan(0);
    expect(lakeState(lake(5, 6), DEFAULT_WEATHER, { full: 5, outlet }).spill).toBeGreaterThan(some);
  });
});

describe('lakeArt', () => {
  it('walls each lake in the style of its height, with snow on the rim of the highest', () => {
    expect(lakeArt(kit, 3, 0, ground).wall).toBe(kit.walls.mossy);
    expect(lakeArt(kit, 7, 0, ground).wall).toBe(kit.walls.snowy);
    expect(lakeArt(kit, 7, 0, ground).rim).toBe(ground.snow[0]);
    expect(lakeArt(kit, 5, 0, ground).rim).toBe(ground.rock[0]);
  });

  it('only spills over the near wall when the lake spills, harder art for harder spills', () => {
    expect(lakeArt(kit, 5, 0, ground).spillWall).toBeUndefined();
    expect(lakeArt(kit, 5, 0.1, ground).spillWall).toBe(kit.spill[0]);
    expect(lakeArt(kit, 5, 1, ground).spillWall).toBe(kit.spill[kit.spill.length - 1]);
  });
});
