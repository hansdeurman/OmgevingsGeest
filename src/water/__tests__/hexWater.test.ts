import { describe, expect, it } from 'vitest';
import { createWaterWorld, stepWater, surfaceOf, totalWater, type Forcing, type WaterWorld } from '../hexWater';

const calm: Forcing = { rain: 0, evaporation: 0 };
/** A world from rows of ground heights (and optionally rows of water depths). */
const world = (ground: number[][], depth?: number[][]) =>
  createWaterWorld(ground[0].length, ground.length, ground.flat(), depth?.flat());
const run = (w: WaterWorld, steps: number, forcing: Forcing = calm) => {
  for (let k = 0; k < steps; k++) w = stepWater(w, forcing);
  return w;
};
const at = (w: WaterWorld, col: number, row: number) => row * w.cols + col;
const spread = (w: WaterWorld, cells: number[]) => {
  const s = cells.map((i) => surfaceOf(w, i));
  return Math.max(...s) - Math.min(...s);
};

/** A closed bowl: high walls all round, a 3x3 floor inside. */
const WALL = 9;
const bowl = (floor: number[][]) => [
  [WALL, WALL, WALL, WALL, WALL],
  ...floor.map((r) => [WALL, ...r, WALL]),
  [WALL, WALL, WALL, WALL, WALL],
];
const inner = [1, 2, 3].flatMap((r) => [1, 2, 3].map((c) => r * 5 + c));

describe('stepWater', () => {
  it('keeps every drop when nothing comes in or goes out', () => {
    const w = world(bowl([[1, 1, 1], [1, 1, 1], [1, 1, 1]]), bowl([[3, 0, 0], [0, 0, 0], [0, 0, 1]]).map((r) => r.map((v) => (v === WALL ? 0 : v))));
    expect(totalWater(run(w, 80))).toBeCloseTo(totalWater(w), 5);
  });

  it('levels an uneven lake out, step by step', () => {
    let w = world(bowl([[1, 1, 1], [1, 1, 1], [1, 1, 1]]));
    w.depth[at(w, 1, 1)] = 4;
    let before = spread(w, inner);
    for (let k = 0; k < 200; k++) {
      w = stepWater(w, calm);
      const now = spread(w, inner);
      expect(now).toBeLessThanOrEqual(before + 1e-9);
      before = now;
    }
    expect(before).toBeLessThan(1e-3);
  });

  it('levels a lake over uneven ground to one surface, deeper where the ground is low', () => {
    const w = run(world(bowl([[1, 1.5, 2], [1, 1.5, 2], [1, 1.5, 2]]), bowl([[3, 0, 0], [3, 0, 0], [3, 0, 0]]).map((r) => r.map((v) => (v === WALL ? 0 : v)))), 300);
    expect(spread(w, inner)).toBeLessThan(1e-3);
    expect(w.depth[at(w, 1, 2)]).toBeGreaterThan(w.depth[at(w, 3, 2)] + 0.9);
  });

  it('never runs water uphill and never leaves a cell with less than none', () => {
    const w = run(world(bowl([[1, 2, 3], [1, 2, 3], [1, 2, 3]]), bowl([[0.5, 0, 0], [0.5, 0, 0], [0.5, 0, 0]]).map((r) => r.map((v) => (v === WALL ? 0 : v)))), 50);
    expect(w.depth[at(w, 3, 2)]).toBe(0);
    expect(Math.min(...w.depth)).toBeGreaterThanOrEqual(0);
  });

  it('keeps two lakes apart at their own levels when a ridge stands between them', () => {
    const ground = bowl([[1, WALL, 1], [1, WALL, 1], [1, WALL, 1]]);
    const depth = bowl([[2, 0, 0.5], [2, 0, 0.5], [2, 0, 0.5]]).map((r) => r.map((v) => (v === WALL ? 0 : v)));
    const w = run(world(ground, depth), 200);
    expect(surfaceOf(w, at(w, 1, 2))).toBeCloseTo(3, 4);
    expect(surfaceOf(w, at(w, 3, 2))).toBeCloseTo(1.5, 4);
  });

  it('fills a bowl in the rain up to its lowest notch, and pours the rest over it to the sea', () => {
    // The right wall has a notch at height 3 leading down to the sea at the map edge.
    const ground = bowl([[1, 1, 1], [1, 1, 1], [1, 1, 1]]);
    ground[2][4] = 3;
    const w = run(world(ground), 3000, { rain: 0.002, evaporation: 0 });
    const lake = surfaceOf(w, at(w, 2, 2));
    expect(lake).toBeGreaterThan(3);
    expect(lake).toBeLessThan(3.3);
    expect(spread(w, inner)).toBeLessThan(0.05);
  });

  it('dries a lake out in a drought, the deepest water last', () => {
    let w = world(bowl([[1, 1.5, 2], [1, 1.5, 2], [1, 1.5, 2]]), bowl([[1.5, 1, 0.5], [1.5, 1, 0.5], [1.5, 1, 0.5]]).map((r) => r.map((v) => (v === WALL ? 0 : v))));
    w = run(w, 60, { rain: 0, evaporation: 0.02 });
    expect(w.depth[at(w, 3, 2)]).toBe(0);
    expect(w.depth[at(w, 1, 2)]).toBeGreaterThan(0);
    w = run(w, 200, { rain: 0, evaporation: 0.02 });
    expect(totalWater(w)).toBe(0);
  });

  it('lets the sea and the map edge swallow what reaches them', () => {
    const w = run(world([[0, 0, 0], [0, 2, 0], [0, 0, 0]], [[0, 0, 0], [0, 1, 0], [0, 0, 0]]), 100);
    expect(totalWater(w)).toBeLessThan(1e-6);
  });

  it('rains only where it is told to', () => {
    const w = world(bowl([[1, 1, 1], [1, 1, 1], [1, 1, 1]]));
    const rain = new Float32Array(25);
    rain[at(w, 1, 1)] = 0.5;
    expect(totalWater(stepWater(w, { rain, evaporation: 0 }))).toBeCloseTo(0.5, 6);
  });
});
