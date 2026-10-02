import { describe, expect, it } from 'vitest';
import { hexTopology } from '../hexTopology';
import { flowStep, outflow, type FlowParams } from '../pipeFlow';

/** A world from rows of ground heights, with water, pipes and sinks (the map's edge). */
const world = (ground: number[][], depth?: number[][], dirs: 6 | 12 = 12) => {
  const [cols, rows] = [ground[0].length, ground.length];
  const topo = hexTopology(cols, rows, dirs);
  const sink = Uint8Array.from({ length: cols * rows }, (_, i) => (i % cols === 0 || i % cols === cols - 1 || i < cols || i >= cols * (rows - 1) ? 1 : 0));
  return { topo, ground: Float32Array.from(ground.flat()), depth: Float32Array.from(depth?.flat() ?? ground.flat().map(() => 0)), flux: new Float32Array(cols * rows * dirs), sink };
};
type World = ReturnType<typeof world>;
const run = (w: World, steps: number, params?: FlowParams) => {
  for (let k = 0; k < steps; k++) flowStep(w.topo, w.ground, w.depth, w.flux, w.sink, params);
  return w;
};
const total = (w: World) => w.depth.reduce((a, b) => a + b, 0);
const surface = (w: World, i: number) => w.ground[i] + w.depth[i];
const spread = (w: World, cells: number[]) => Math.max(...cells.map((i) => surface(w, i))) - Math.min(...cells.map((i) => surface(w, i)));

/** A closed bowl: high walls all round, a 5x5 floor inside a 7x7 map. */
const WALL = 9;
const bowl = (floor: (c: number, r: number) => number) =>
  Array.from({ length: 7 }, (_, r) => Array.from({ length: 7 }, (_, c) => (c === 0 || r === 0 || c === 6 || r === 6 ? WALL : floor(c, r))));
const inner = Array.from({ length: 25 }, (_, k) => (1 + Math.floor(k / 5)) * 7 + 1 + (k % 5));
const at = (c: number, r: number) => r * 7 + c;
const waterAt = (cells: [number, number, number][]) => bowl(() => 0).map((row, r) => row.map((_, c) => cells.find(([x, y]) => x === c && y === r)?.[2] ?? 0));

describe('flowStep', () => {
  it('keeps every drop when nothing comes in or goes out', () => {
    const w = world(bowl(() => 1), waterAt([[1, 1, 3], [5, 5, 1]]));
    const before = total(w);
    expect(total(run(w, 200))).toBeCloseTo(before, 4);
  });

  it('spreads a heap of water into every direction at once', () => {
    const w = run(world(bowl(() => 1), waterAt([[3, 3, 2]])), 1);
    const out = Array.from({ length: 12 }, (_, d) => w.flux[at(3, 3) * 12 + d]);
    expect(out.filter((f) => f > 0)).toHaveLength(12);
  });

  it('levels an uneven lake out, not at once but over many steps', () => {
    const w = world(bowl(() => 1), waterAt([[1, 3, 4]]));
    expect(spread(run(w, 5), inner)).toBeGreaterThan(0.3);
    expect(spread(run(w, 400), inner)).toBeLessThan(0.02);
  });

  it('levels a lake over uneven ground to one surface, deeper where the ground is low', () => {
    const w = run(world(bowl((c) => 1 + (c - 1) * 0.3), waterAt([1, 2, 3, 4, 5].map((r) => [1, r, 3] as [number, number, number]))), 600);
    expect(spread(w, inner)).toBeLessThan(0.02);
    expect(w.depth[at(1, 3)]).toBeGreaterThan(w.depth[at(5, 3)] + 1);
  });

  it('takes several steps to carry a flood down a long slope, spread out over time', () => {
    // A slope from left to right; one pulse of water poured at the top runs down it.
    const w = world(bowl((c) => 6 - c));
    w.depth[at(1, 3)] = 1;
    const running = Array.from({ length: 20 }, () => (run(w, 1), outflow(w.topo, w.flux, at(3, 3)) > 1e-3));
    expect(running.indexOf(true)).toBeGreaterThanOrEqual(1);
    expect(running.filter(Boolean).length).toBeGreaterThanOrEqual(3);
  });

  it('never runs water uphill and never leaves a hex with less than none', () => {
    const w = run(world(bowl((c) => c), waterAt([[1, 3, 0.5]])), 100);
    expect(w.depth[at(5, 3)]).toBe(0);
    expect(Math.min(...w.depth)).toBeGreaterThanOrEqual(0);
  });

  for (const dirs of [6, 12] as const) {
    it(`keeps two lakes apart at their own levels when a ridge stands between them (${dirs} directions)`, () => {
      const ground = bowl((c) => (c === 3 ? WALL : 1));
      const depth = waterAt([1, 2, 3, 4, 5].flatMap((r) => [[1, r, 2], [2, r, 2], [4, r, 0.5], [5, r, 0.5]] as [number, number, number][]));
      const w = run(world(ground, depth, dirs), 300);
      expect(surface(w, at(1, 3))).toBeCloseTo(3, 2);
      expect(surface(w, at(5, 3))).toBeCloseTo(1.5, 2);
    });
  }

  it('lets the map\'s edge swallow what reaches it', () => {
    const w = run(world([[0, 0, 0], [0, 2, 0], [0, 0, 0]], [[0, 0, 0], [0, 1, 0], [0, 0, 0]]), 100);
    expect(total(w)).toBeLessThan(1e-6);
  });
});
