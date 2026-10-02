import { describe, expect, it } from 'vitest';
import { WETNESS } from '../../water/wetness';
import { gradeGround, gradeTexel, groundDetail } from '../wetGround';
import { hexBlend, blendField } from '../hexField';
import { gridFrame } from '../geometry';
import { createRaster, getPixel, setPixel } from '../raster';
import type { RGB } from '../../rendering/palette';

const GRASS: RGB = [92, 150, 62];
const SAND: RGB = [214, 190, 140];
const ROCK: RGB = [128, 124, 120];
const SNOW: RGB = [240, 244, 248];
const WATER: RGB = [40, 110, 160];
const look = (c: RGB, stage: number, puddle = 0.5, crack = 0) => gradeTexel(c, stage, puddle, crack, WATER);
const lum = ([r, g, b]: RGB) => 0.3 * r + 0.59 * g + 0.11 * b;
const greenness = ([r, g, b]: RGB) => g - Math.max(r, b);
const blueness = ([r, g, b]: RGB) => b - Math.max(r, g) * 0.8;
const distance = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('gradeTexel', () => {
  it('leaves ground of normal wetness as it is', () => {
    for (const c of [GRASS, SAND, ROCK, SNOW]) expect(look(c, WETNESS.normal)).toEqual(c);
  });

  it('yellows grass when dry and turns it to straw when parched', () => {
    const [normal, dry, parched] = [look(GRASS, WETNESS.normal), look(GRASS, WETNESS.dry), look(GRASS, WETNESS.parched)];
    expect(greenness(dry)).toBeLessThan(greenness(normal) - 15);
    expect(greenness(parched)).toBeLessThan(greenness(dry) - 15);
    expect(parched[0]).toBeGreaterThan(parched[2] + 60); // straw: warm, not grey
  });

  it('cracks parched ground, but not ground that is merely dry', () => {
    expect(lum(look(SAND, WETNESS.parched, 0.5, 1))).toBeLessThan(lum(look(SAND, WETNESS.parched, 0.5, 0)) - 30);
    expect(look(SAND, WETNESS.dry, 0.5, 1)).toEqual(look(SAND, WETNESS.dry, 0.5, 0));
  });

  it('darkens moist ground, with a puddle only in its very lowest spots', () => {
    const moist = look(SAND, WETNESS.moist);
    expect(lum(moist)).toBeLessThan(lum(SAND) - 15);
    expect(blueness(moist)).toBeLessThan(0);
    expect(blueness(look(SAND, WETNESS.moist, 0.01))).toBeGreaterThan(0);
  });

  it('pools water all over soaked ground, between drier patches', () => {
    expect(blueness(look(GRASS, WETNESS.soaked, 0.25))).toBeGreaterThan(0);
    expect(blueness(look(GRASS, WETNESS.soaked, 0.9))).toBeLessThan(0);
  });

  it('puts flooded ground under water everywhere, darker the deeper it lies', () => {
    for (const p of [0.01, 0.5, 0.99]) expect(blueness(look(GRASS, WETNESS.flooded, p))).toBeGreaterThan(0);
    expect(lum(look(GRASS, WETNESS.deep))).toBeLessThan(lum(look(GRASS, WETNESS.flooded)) - 10);
  });

  it('shows each stage clearly apart from the next', () => {
    const stages = [WETNESS.parched, WETNESS.dry, WETNESS.normal, WETNESS.moist, WETNESS.soaked, WETNESS.flooded];
    // On average over the ground's spots: puddles and cracks show where the detail says.
    const mean = (c: RGB, s: number): RGB => {
      const sum: RGB = [0, 0, 0];
      for (let k = 0; k < 20; k++) look(c, s, (k + 0.5) / 20, k % 4 === 0 ? 1 : 0).forEach((v, n) => (sum[n] += v / 20));
      return sum;
    };
    for (const c of [GRASS, SAND]) for (let k = 1; k < stages.length; k++) expect(distance(mean(c, stages[k]), mean(c, stages[k - 1]))).toBeGreaterThan(18);
  });

  it('keeps snow white in a drought', () => {
    expect(look(SNOW, WETNESS.parched, 0.5, 1)).toEqual(SNOW);
  });
});

describe('groundDetail', () => {
  const detail = groundDetail(7);

  it('is the same for the same seed', () => {
    expect(groundDetail(7).crack).toEqual(detail.crack);
  });

  it('draws cracks as thin lines over a small share of the ground', () => {
    const share = detail.crack.filter((v) => v > 128).length / detail.crack.length;
    expect(share).toBeGreaterThan(0.03);
    expect(share).toBeLessThan(0.25);
  });

  it('spreads its puddle spots from the lowest to the highest', () => {
    const low = detail.puddle.filter((v) => v < 50).length / detail.puddle.length;
    const high = detail.puddle.filter((v) => v > 205).length / detail.puddle.length;
    expect(low).toBeGreaterThan(0.03);
    expect(high).toBeGreaterThan(0.03);
  });
});

describe('gradeGround', () => {
  const SIZE = 20;
  const [cols, rows] = [4, 3];
  const frame = gridFrame(cols, rows, SIZE);
  const blend = hexBlend(cols, rows, frame, SIZE);
  const base = createRaster(frame.width, frame.height);
  for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) setPixel(base, x, y, GRASS);
  const keep = new Uint8Array(frame.width * frame.height);
  keep[0] = 1;
  setPixel(base, 0, 0, WATER);
  const graded = (stage: number) => {
    const out = createRaster(frame.width, frame.height);
    gradeGround(base, out, blend, blendField(blend, new Float32Array(cols * rows).fill(stage)), keep, groundDetail(1), () => WATER);
    return out;
  };

  it('grades every pixel by the wetness of its hexes', () => {
    const [r, g] = getPixel(graded(WETNESS.parched), 30, 20);
    expect(g - r).toBeLessThan(greenness(GRASS) - 30);
    expect(getPixel(graded(WETNESS.normal), 30, 20).slice(0, 3)).toEqual(GRASS);
  });

  it('leaves the pixels it is told to keep (open water, off the map) alone', () => {
    expect(getPixel(graded(WETNESS.parched), 0, 0).slice(0, 3)).toEqual(WATER);
  });
});
