import { describe, expect, it } from 'vitest';
import { createHydroWorld, snapshot, stepHydro, totalWater } from '../hydroWorld';
import { outflow } from '../pipeFlow';
import { soakOf, type Weather } from '../retention';

const N = 9;
const WALL = 9;
/** A bowl on a 9x9 map: high walls (two thick on the right), a floor inside, `notch` cutting the right wall at row 4 down to the map's edge. */
const bowlGround = (floor: number, notch?: number) =>
  Array.from({ length: N * N }, (_, i) => {
    const [c, r] = [i % N, Math.floor(i / N)];
    if (notch !== undefined && r === 4 && c >= N - 2) return c === N - 1 ? 0 : notch;
    return c === 0 || r === 0 || c >= N - 2 || r === N - 1 ? WALL : floor;
  });
const at = (c: number, r: number) => r * N + c;
const world = (ground: number[], grass = 0, trees = 0) => createHydroWorld({ cols: N, rows: N, ground, soak: () => soakOf(grass, trees, 1) });
const rain = (r: number): Weather => ({ rain: r, warmth: 0.3, evaporation: 0 });
const run = (w: ReturnType<typeof world>, steps: number, weather: (k: number) => Weather) => {
  for (let k = 0; k < steps; k++) stepHydro(w, weather(k));
  return w;
};

describe('a hydro world', () => {
  it('fills a bowl in the rain, slower where forest soaks the rain up first', () => {
    const bare = run(world(bowlGround(1)), 60, () => rain(0.01));
    const forest = run(world(bowlGround(1), 4, 4), 60, () => rain(0.01));
    expect(bare.depth[at(4, 4)]).toBeGreaterThan(forest.depth[at(4, 4)] + 0.05);
  });

  it("pours out of the bowl's notch once it is full, and keeps pouring for a while after the rain", () => {
    const w = run(world(bowlGround(1, 2)), 900, () => rain(0.004));
    expect(w.depth[at(4, 4)] + 1).toBeGreaterThan(2);
    expect(outflow(w.topo, w.flux, at(N - 2, 4))).toBeGreaterThan(0);
    run(w, 30, () => rain(0));
    expect(outflow(w.topo, w.flux, at(N - 2, 4))).toBeGreaterThan(0);
  });

  it('melts a glacier into a stream that runs all summer', () => {
    const ground = Array.from({ length: N * N }, (_, i) => (i % N === 0 || i % N === N - 1 ? 0 : 8 - (i % N) * 0.8));
    const w = createHydroWorld({ cols: N, rows: N, ground, soak: (i) => soakOf(0, 0, ground[i]), snow: (i) => (ground[i] > 7 ? 3 : 0) });
    run(w, 200, () => ({ rain: 0, warmth: 1, evaporation: 0 }));
    const stream = Math.max(...Array.from({ length: N }, (_, r) => outflow(w.topo, w.flux, at(4, r))));
    expect(stream).toBeGreaterThan(0);
    expect(w.snow[at(1, 4)]).toBeGreaterThan(0);
  });

  it('takes a snapshot that later steps leave alone', () => {
    const w = world(bowlGround(1));
    const before = snapshot(w);
    run(w, 5, () => rain(0.1));
    expect(totalWater(before.depth)).toBe(0);
    expect(totalWater(w.depth)).toBeGreaterThan(0);
  });
});
