import { describe, expect, it } from 'vitest';
import { hexTopology } from '../hexTopology';
import { erodeStep, hardnessOf, type ErosionParams } from '../erosion';
import { flowStep } from '../pipeFlow';

/** A world from rows of ground heights, with water, flow, sediment and hardness. */
const world = (ground: number[][], hardness = 0.3) => {
  const [cols, rows] = [ground[0].length, ground.length];
  const n = cols * rows;
  const edge = (i: number) => i % cols === 0 || i % cols === cols - 1 || i < cols || i >= n - cols;
  return {
    topo: hexTopology(cols, rows, 12),
    ground: Float32Array.from(ground.flat()),
    depth: new Float32Array(n),
    flux: new Float32Array(n * 12),
    sediment: new Float32Array(n),
    hardness: new Float32Array(n).fill(hardness),
    sink: Uint8Array.from({ length: n }, (_, i) => (edge(i) ? 1 : 0)),
  };
};
type World = ReturnType<typeof world>;
/** Wearing faster than the game does, so a few hundred steps show it; talus and slump as for cliffs. */
const FAST: Partial<ErosionParams> = { erosion: 0.05, talus: 1.6, slump: 0.02 };
const step = (w: World, params?: Partial<ErosionParams>) => {
  flowStep(w.topo, w.ground, w.depth, w.flux, w.sink);
  erodeStep(w.topo, w.ground, w.depth, w.flux, w.sediment, w.hardness, w.sink, { ...FAST, ...params });
};
const sum = (a: Float32Array, skip?: Uint8Array) => a.reduce((s, v, i) => (skip?.[i] ? s : s + v), 0);
const at = (cols: number) => (c: number, r: number) => r * cols + c;

const WALL = 9;
/** A 9x7 map: a lake held by a rim, the rim dropping in a step to a lower plain, which slopes to the map's edge. */
const ledge = () =>
  Array.from({ length: 7 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => (r === 0 || r === 6 || c === 0 ? WALL : c <= 3 ? 3 : c === 4 ? 3.2 : 2 - (c - 5) * 0.3)),
  );

describe('erodeStep', () => {
  it('cuts the edge water pours over, a little at a time', () => {
    const w = world(ledge());
    const lip = at(9)(4, 3);
    const before = w.ground[lip];
    for (let k = 0; k < 400; k++) {
      for (const i of [at(9)(1, 2), at(9)(1, 3), at(9)(1, 4)]) w.depth[i] += 0.05; // a river feeding the lake
      step(w);
    }
    expect(w.ground[lip]).toBeLessThan(before - 0.05);
    expect(w.ground[lip]).toBeGreaterThan(before - 1.5); // gradually, not all at once
  });

  it('lets the lake behind the cut run lower: what pours out has left it', () => {
    const w = world(ledge());
    const lake = at(9)(2, 3);
    const levels: number[] = [];
    for (let k = 0; k < 1200; k++) {
      if (k < 600) for (const i of [at(9)(1, 2), at(9)(1, 3), at(9)(1, 4)]) w.depth[i] += 0.05;
      step(w, { erosion: 0.2 });
      if (k === 599 || k === 1199) levels.push(w.ground[lake] + w.depth[lake]);
    }
    expect(levels[1]).toBeLessThan(levels[0]);
  });

  it('erodes hard rock far slower than soft ground', () => {
    const cut = (hardness: number) => {
      const w = world(ledge(), hardness);
      for (let k = 0; k < 300; k++) {
        for (const i of [at(9)(1, 2), at(9)(1, 3), at(9)(1, 4)]) w.depth[i] += 0.05;
        step(w);
      }
      return 3.2 - w.ground[at(9)(4, 3)];
    };
    expect(cut(0.9)).toBeLessThan(cut(0.1) / 3);
  });

  it('loses no ground: what is cut away is carried and laid down elsewhere', () => {
    const ground = ledge().map((row, r) => row.map((g, c) => (c === 8 && r > 0 && r < 6 ? 1 : g))); // a closed map: the edge is high
    const w = world(ground);
    w.sink.fill(0);
    for (const i of [at(9)(1, 3)]) w.depth[i] = 5;
    const before = sum(w.ground) + sum(w.sediment);
    for (let k = 0; k < 300; k++) step(w);
    expect(sum(w.ground) + sum(w.sediment)).toBeCloseTo(before, 2);
  });

  it('lays sediment down where the water slows, in a lake', () => {
    // A slope running into a flat, closed basin: the slope wears down, the basin silts up.
    const ground = Array.from({ length: 7 }, (_, r) => Array.from({ length: 9 }, (_, c) => (r === 0 || r === 6 || c === 0 || c === 8 ? WALL : c <= 3 ? 5 - c : 1)));
    const w = world(ground);
    const basin = at(9)(6, 3);
    for (let k = 0; k < 400; k++) {
      w.depth[at(9)(1, 3)] += 0.05;
      step(w);
    }
    expect(w.ground[basin]).toBeGreaterThan(1);
  });

  it('lets a cliff slump into a slope over time, but leaves gentle slopes alone', () => {
    const rows = (...row: number[]) => Array.from({ length: 5 }, () => row);
    const cliff = world(rows(6, 6, 6, 1, 1));
    const gentle = world(rows(2.5, 2, 1.5, 1, 0.5));
    [cliff, gentle].forEach((w) => w.sink.fill(0));
    const i = at(5)(2, 2);
    for (let k = 0; k < 200; k++) [cliff, gentle].forEach((w) => step(w));
    expect(cliff.ground[i]).toBeLessThan(6);
    expect(gentle.ground[i]).toBeCloseTo(1.5, 4);
  });
});

describe('hardnessOf', () => {
  it('makes bare rock high up hardest, roots hold ground together, sand gives way easiest', () => {
    expect(hardnessOf(0, 0, 7)).toBeGreaterThan(hardnessOf(2, 3, 2));
    expect(hardnessOf(2, 3, 2)).toBeGreaterThan(hardnessOf(0, 0, 1));
  });
});
