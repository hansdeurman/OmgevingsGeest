import { describe, expect, it } from 'vitest';
import { hexTopology } from '../hexTopology';
import { createWind, DEFAULT_WIND, MOST_WIND, ROUGH, roughnessOf, windStep, type WindParams } from '../wind';

const [cols, rows] = [14, 10];
const n = cols * rows;
const topo = hexTopology(cols, rows, 6);
const middle = 5 * cols + 7;
const xOf = (i: number) => (i % cols) + (Math.floor(i / cols) & 1) / 2;
/** Air warmer eastward by `rise` degrees per hex. */
const warmEast = (rise: number) => Float32Array.from({ length: n }, (_, i) => 10 + rise * xOf(i));
const even = (r: number) => new Float32Array(n).fill(r);
const still: WindParams = { ...DEFAULT_WIND, turning: 0, eddies: 0 };
/** The wind after it has settled under `air` over ground this rough. */
function settled(air: Float32Array, rough = even(ROUGH.land), p = still, steps = 30) {
  const wind = createWind(n);
  for (let k = 0; k < steps; k++) windStep(topo, wind, air, rough, p, k, 1);
  return wind;
}

describe('windStep', () => {
  it('blows from cool air toward warm air, harder the bigger the difference', () => {
    const [weak, strong] = [settled(warmEast(0.2)), settled(warmEast(0.6))];
    expect(weak.x[middle]).toBeGreaterThan(0.02);
    expect(Math.abs(weak.y[middle])).toBeLessThan(0.01);
    expect(strong.x[middle]).toBeGreaterThan(2 * weak.x[middle]);
  });

  it('is slowed by rough ground, least over the sea', () => {
    const [sea, forest] = [settled(warmEast(0.3), even(ROUGH.sea)), settled(warmEast(0.3), even(ROUGH.forest))];
    expect(sea.x[middle]).toBeGreaterThan(2 * forest.x[middle]);
  });

  it("turns to the right as the world spins, more over smooth sea than rough land", () => {
    const spin = { ...still, turning: 0.5 };
    const [sea, land] = [settled(warmEast(0.3), even(ROUGH.sea), spin), settled(warmEast(0.3), even(ROUGH.forest), spin)];
    expect(sea.y[middle]).toBeGreaterThan(0); // blowing east, turned south
    const angle = (w: typeof sea) => Math.atan2(w.y[middle], w.x[middle]);
    expect(angle(sea)).toBeGreaterThan(angle(land));
  });

  it('stays calm where the air is evenly warm, without eddies', () => {
    const wind = settled(even(12));
    expect(Math.max(...wind.x.map(Math.abs), ...wind.y.map(Math.abs))).toBeLessThan(1e-6);
  });

  it('stirs even air with eddies that come and go, adding no pressure overall', () => {
    const p = { ...still, eddies: 1 };
    const [a, b] = [settled(even(12), even(ROUGH.land), p, 30), settled(even(12), even(ROUGH.land), p, 90)];
    expect(Math.max(...a.x.map(Math.abs))).toBeGreaterThan(0.02);
    expect(a.x[middle]).not.toBeCloseTo(b.x[middle], 3);
    expect(Math.abs(a.pressure.reduce((s, v) => s + v, 0) / n)).toBeLessThan(1e-4);
  });

  it('wraps its eddies around the map\'s edges as the sky does: no seam', () => {
    const wind = settled(even(12), even(ROUGH.land), { ...still, eddies: 2 }, 5);
    const p = wind.pressure;
    const step = (a: number, b: number) => Math.abs(p[a] - p[b]);
    const across = Array.from({ length: rows }, (_, r) => step(r * cols, r * cols + cols - 1));
    const inside = Array.from({ length: rows }, (_, r) => step(r * cols + 5, r * cols + 6));
    expect(Math.max(...across)).toBeLessThan(3 * Math.max(...inside) + 0.05);
  });

  it('never blows harder than the most it can', () => {
    const wind = settled(warmEast(20), even(ROUGH.sea));
    for (let i = 0; i < n; i++) expect(Math.hypot(wind.x[i], wind.y[i])).toBeLessThanOrEqual(MOST_WIND + 1e-6);
  });

  it('picks up and dies down over a few steps, not at once', () => {
    const wind = createWind(n);
    windStep(topo, wind, warmEast(0.3), even(ROUGH.land), still, 0, 1);
    const first = wind.x[middle];
    for (let k = 1; k < 30; k++) windStep(topo, wind, warmEast(0.3), even(ROUGH.land), still, k, 1);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.8 * wind.x[middle]);
  });
});

describe('roughnessOf', () => {
  it('makes forest and mountains rougher than open land', () => {
    expect(roughnessOf(0, 1)).toBe(ROUGH.land);
    expect(roughnessOf(4, 1)).toBeCloseTo(ROUGH.forest);
    expect(roughnessOf(0, 7)).toBeCloseTo(ROUGH.mountain);
  });
});
