import { describe, expect, it } from 'vitest';
import { WATER_KINDS, lakeTemperature, waterColour, waterWeights, waveCrest, type WaterTextures } from '../waterLook';
import { HIGH_LAKE_FROM } from '../shores';
import { MAX_ELEVATION } from '../levels';
import { paintRaster } from '../raster';
import type { RGB } from '../../rendering/palette';

const solid = (c: RGB) => paintRaster(4, 4, () => c);
const textures: WaterTextures = { ice: solid([220, 240, 250]), cold: solid([40, 90, 140]), mild: solid([70, 140, 150]), warm: solid([80, 140, 100]) };
const mean = (f: (x: number, y: number) => number) => {
  let s = 0;
  for (let y = 0; y < 120; y++) for (let x = 0; x < 120; x++) s += f(x, y);
  return s / 120 ** 2;
};

describe('waterWeights', () => {
  it('always adds up to one', () => {
    for (let t = 0; t <= 1; t += 0.05) expect(waterWeights(t).reduce((a, b) => a + b)).toBeCloseTo(1, 6);
  });

  it('is ice when frozen and warm water at the top of the scale', () => {
    expect(waterWeights(0)[WATER_KINDS.indexOf('ice')]).toBe(1);
    expect(waterWeights(1)[WATER_KINDS.indexOf('warm')]).toBe(1);
  });

  it('holds one look over most of its range and blends only neighbours', () => {
    expect(waterWeights(2 / 3)).toEqual([0, 0, 1, 0]);
    expect(waterWeights(0.5).filter((w) => w > 0)).toHaveLength(2);
  });
});

describe('lakeTemperature', () => {
  it('is colder for higher lakes and warmer in summer', () => {
    expect(lakeTemperature(MAX_ELEVATION - 1, 0)).toBeLessThan(lakeTemperature(HIGH_LAKE_FROM, 0));
    expect(lakeTemperature(5, 0.5)).toBeGreaterThan(lakeTemperature(5, 0));
  });

  it('freezes high lakes in a hard winter and warms foothill lakes in summer', () => {
    expect(lakeTemperature(MAX_ELEVATION - 1, -1)).toBe(0);
    expect(lakeTemperature(HIGH_LAKE_FROM, 1)).toBe(1);
  });
});

describe('waveCrest', () => {
  it('leaves calm water smooth', () => {
    expect(mean((x, y) => waveCrest(x, y, { strength: 0, direction: 0 }, 20))).toBe(0);
  });

  it('raises more and brighter crests the harder the wind blows', () => {
    const at = (strength: number) => mean((x, y) => waveCrest(x, y, { strength, direction: 0.6 }, 20));
    expect(at(0.3)).toBeGreaterThan(0);
    expect(at(1)).toBeGreaterThan(2 * at(0.3));
  });
});

describe('waterColour', () => {
  it('shows the texture of the water\'s temperature', () => {
    expect(waterColour(textures, 1, 1, waterWeights(0), 0)).toEqual([220, 240, 250]);
    expect(waterColour(textures, 1, 1, waterWeights(1), 0)).toEqual([80, 140, 100]);
  });

  it('lights wave crests, but ice does not move', () => {
    expect(waterColour(textures, 1, 1, waterWeights(2 / 3), 1)[0]).toBeGreaterThan(100);
    expect(waterColour(textures, 1, 1, waterWeights(0), 1)).toEqual([220, 240, 250]);
  });
});
