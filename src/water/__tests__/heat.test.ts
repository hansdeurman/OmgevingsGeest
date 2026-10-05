import { describe, expect, it } from 'vitest';
import { airTemperature, albedoOf, ALBEDO, createHeat, DEFAULT_HEAT, heatStep, type HeatFlows, type HeatParams } from '../heat';
import { LAPSE } from '../retention';
import { YEAR, yearShare } from '../sun';

/** A row of `n` hexes, far enough apart in what they are that mixing is off. */
const still = { ...DEFAULT_HEAT, mixing: 0 };
const calm = (n: number, over: Partial<HeatFlows> = {}): HeatFlows => ({
  cloud: new Float32Array(n),
  evaporated: new Float32Array(n),
  condensed: new Float32Array(n),
  windX: new Float32Array(n),
  windY: new Float32Array(n),
  ...over,
});
/** Run hexes of these `heights`, `albedo`s and `capacity`s through `years`; returns each hex's surface temperature per step of the last year. */
function run(heights: number[], albedo: number[], capacity: number[], years = 3, p: HeatParams = still, flows: Partial<HeatFlows> = {}) {
  const n = heights.length;
  const heat = createHeat(n, 1, heights, 6);
  const surface = { albedo: Float32Array.from(albedo), capacity: Float32Array.from(capacity) };
  const last: number[][] = heights.map(() => []);
  for (let k = 0; k < years * YEAR; k++) {
    heatStep(heat, yearShare(k), surface, calm(n, flows), p);
    if (k >= (years - 1) * YEAR) heat.surface.forEach((t, i) => last[i].push(t));
  }
  return { heat, last };
}
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const range = (a: number[]) => Math.max(...a) - Math.min(...a);

describe('heatStep', () => {
  it('warms in summer and cools in winter, the sea less and later than the land', () => {
    const { last } = run([1, 0], [0.19, 0.07], [1, DEFAULT_HEAT.seaMemory]);
    const [land, sea] = last;
    expect(range(land)).toBeGreaterThan(10);
    expect(range(sea)).toBeLessThan(range(land) / 2);
    const warmest = (a: number[]) => a.indexOf(Math.max(...a));
    expect(warmest(sea)).toBeGreaterThan(warmest(land) + YEAR / 24);
    expect(mean(land)).toBeGreaterThan(0);
    expect(mean(land)).toBeLessThan(20);
  });

  it('is colder on a mountain, in the air and on the ground, the air around it being as warm as elsewhere', () => {
    const [cols, rows] = [7, 7];
    const n = cols * rows;
    const peak = 3 * cols + 3;
    const heat = createHeat(cols, rows, Array.from({ length: n }, (_, i) => (i === peak ? 7 : 0.5)), 6);
    const surface = { albedo: new Float32Array(n).fill(0.19), capacity: new Float32Array(n).fill(1) };
    for (let k = 0; k < YEAR; k++) heatStep(heat, yearShare(k), surface, calm(n));
    expect(airTemperature(heat, peak)).toBeLessThan(airTemperature(heat, peak - 2) - 0.8 * 6.5 * LAPSE);
    expect(heat.surface[peak]).toBeLessThan(heat.surface[peak - 2] - 4);
  });

  it('stays colder where the ground is bright, as under snow', () => {
    const { last } = run([1, 1], [0.19, 0.55], [1, 1]);
    expect(mean(last[1])).toBeLessThan(mean(last[0]) - 2);
  });

  it('shades the ground under clouds in summer', () => {
    const clear = run([1], [0.19], [1]).last[0];
    const cloudy = run([1], [0.19], [1], 3, still, { cloud: Float32Array.of(1) }).last[0];
    expect(Math.max(...cloudy)).toBeLessThan(Math.max(...clear) - 1);
  });

  it('cools the ground where water evaporates, and warms the air where it condenses', () => {
    const dry = createHeat(2, 1, [1, 1], 6);
    const wet = createHeat(2, 1, [1, 1], 6);
    const surface = { albedo: Float32Array.of(0.19, 0.19), capacity: Float32Array.of(1, 1) };
    heatStep(dry, 0.5, surface, calm(2), still);
    heatStep(wet, 0.5, surface, calm(2, { evaporated: Float32Array.of(0.01, 0), condensed: Float32Array.of(0, 0.01) }), still);
    expect(wet.surface[0]).toBeLessThan(dry.surface[0] - 0.5);
    expect(wet.air[1]).toBeGreaterThan(dry.air[1] + 0.3);
  });

  it('lets heat leave to space: without sun everything cools', () => {
    const { last } = run([1, 0], [0.19, 0.07], [1, 15], 2, { ...still, sun: 0 });
    expect(Math.max(...last[0])).toBeLessThan(-15);
    expect(last[1].at(-1)!).toBeLessThan(last[1][0]);
  });

  it('keeps warmer the more of its heat the air holds back', () => {
    const thin = run([1], [0.19], [1], 2, { ...still, greenhouse: 0.1 }).last[0];
    const thick = run([1], [0.19], [1], 2, { ...still, greenhouse: 0.5 }).last[0];
    expect(mean(thick)).toBeGreaterThan(mean(thin) + 3);
  });

  it('carries warm air with the wind and mixes it with its neighbours', () => {
    const [cols, rows] = [12, 5];
    const n = cols * rows;
    const heat = createHeat(cols, rows, new Array(n).fill(0), 5);
    heat.air[2 * cols + 3] = 25;
    const surface = { albedo: new Float32Array(n).fill(0.2), capacity: new Float32Array(n).fill(1) };
    for (let k = 0; k < 5; k++) heatStep(heat, 0.25, surface, calm(n, { windX: new Float32Array(n).fill(0.4) }), { ...DEFAULT_HEAT, sun: 0 });
    const row = Array.from(heat.air.subarray(2 * cols, 3 * cols));
    expect(row.indexOf(Math.max(...row))).toBeGreaterThan(3);
    expect(Math.max(...row)).toBeLessThan(25);
  });
});

describe('albedoOf', () => {
  it('makes forest darkest, sand brightest, bare rock high up between', () => {
    expect(albedoOf(3, 4, 1)).toBeCloseTo(ALBEDO.forest);
    expect(albedoOf(0, 0, 1)).toBeCloseTo(ALBEDO.sand);
    expect(albedoOf(3, 0, 1)).toBeLessThan(ALBEDO.sand);
    expect(albedoOf(0, 0, 7)).toBeCloseTo(ALBEDO.rock);
  });
});
