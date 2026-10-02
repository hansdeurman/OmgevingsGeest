import { describe, expect, it } from 'vitest';
import { DEFAULT_WATER, lakeArt, lakeState, placeholderLakeKit, wallStyle } from '../highLakes';
import { createPlaceholderTextures } from '../placeholderTextures';
import { HIGH_LAKE_FROM, lakeLift } from '../shores';
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
  const at = (fill: number) => lakeState(5, SIZE, { ...DEFAULT_WATER, fill });

  it('raises the rim with the lake\'s height', () => {
    expect(at(1).rim).toBeCloseTo(lakeLift(5) * SIZE, 6);
  });

  it('fills a full lake to its rim and a low one part of the way', () => {
    expect(at(1).water).toBe(at(1).rim);
    expect(at(0.5).water).toBeCloseTo(at(1).rim / 2, 6);
    expect(at(1).spill).toBe(0);
  });

  it('spills ever harder above full, the water staying at the rim', () => {
    expect(at(1.1).water).toBe(at(1).rim);
    expect(at(1.1).spill).toBeGreaterThan(0);
    expect(at(1.3).spill).toBe(1);
  });

  it('warms the water in summer', () => {
    expect(lakeState(5, SIZE, { ...DEFAULT_WATER, warmth: 1 }).temperature).toBeGreaterThan(at(1).temperature);
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
