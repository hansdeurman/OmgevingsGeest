import { describe, expect, it } from 'vitest';
import { accumulate, channelStep, createChannels, floodRoute, waterBalance } from '../channels';
import { hexTopology, opposite, pipeTarget } from '../hexTopology';

/** Odd-r neighbours of hex i on a `cols`-wide map. */
const neighbours = (cols: number, rows: number, i: number) => {
  const t = hexTopology(cols, rows, 6);
  return Array.from({ length: 6 }, (_, d) => pipeTarget(t, i, d)).filter((j) => j >= 0);
};
const edgeSinks = (cols: number, rows: number) =>
  Uint8Array.from({ length: cols * rows }, (_, i) => (i % cols === 0 || i % cols === cols - 1 || i < cols || i >= cols * (rows - 1) ? 1 : 0));

describe('floodRoute', () => {
  const [cols, rows] = [7, 7];
  const sink = edgeSinks(cols, rows);

  it('sends every hex down to a lower (or equal) neighbour, ending where water leaves the map', () => {
    const ground = Float32Array.from({ length: cols * rows }, (_, i) => 1 + (i % cols) * 0.5); // rising eastwards
    const { down } = floodRoute(hexTopology(cols, rows, 6), ground, sink);
    for (let i = 0; i < cols * rows; i++) {
      if (sink[i]) {
        expect(down[i]).toBe(-1);
        continue;
      }
      expect(neighbours(cols, rows, i)).toContain(down[i]);
      expect(ground[down[i]]).toBeLessThanOrEqual(ground[i]);
    }
  });

  it('routes a hollow out over the lowest point of its rim, not into a dead end', () => {
    const ground = new Float32Array(cols * rows).fill(5);
    const pit = 3 * cols + 3;
    ground[pit] = 1;
    ground[3 * cols + 4] = 3; // the low point of its rim, on the way east
    ground[3 * cols + 5] = 2;
    ground[3 * cols + 6] = 0; // the sea beyond
    const { down } = floodRoute(hexTopology(cols, rows, 6), ground, sink);
    const path = [pit];
    while (down[path.at(-1)!] >= 0) path.push(down[path.at(-1)!]);
    expect(path.slice(0, 4)).toEqual([pit, 3 * cols + 4, 3 * cols + 5, 3 * cols + 6]);
  });

  it('lists each hex after the hex it runs on to, so water can be gathered upstream first', () => {
    const ground = Float32Array.from({ length: cols * rows }, (_, i) => Math.sin(i * 1.7) + 2);
    const { down, order } = floodRoute(hexTopology(cols, rows, 6), ground, sink);
    const rank = new Int32Array(cols * rows);
    order.forEach((i, k) => (rank[i] = k));
    for (let i = 0; i < cols * rows; i++) if (down[i] >= 0) expect(rank[down[i]]).toBeLessThan(rank[i]);
  });
});

describe('floodRoute joining streams', () => {
  const [cols, rows] = [7, 7];
  const sink = edgeSinks(cols, rows);
  const ground = Float32Array.from({ length: cols * rows }, (_, i) => 1 + Math.floor(i / cols) * 0.5); // falling north, evenly
  const bed = Float32Array.from({ length: cols * rows }, (_, i) => (i % cols === 3 ? 0.2 : 0)); // a river down column 3
  const { down, order } = floodRoute(hexTopology(cols, rows, 6), ground, sink, bed);

  it('draws water into a neighbour already carrying a river, if it lies no higher: streams join', () => {
    expect(down[5 * cols + 2] % cols).toBe(3); // from (2, 5) into the river, not on north beside it
    expect(down[4 * cols + 3]).toBe(3 * cols + 3); // the river keeps its course
  });

  it('never draws water uphill or round in circles', () => {
    const rank = new Int32Array(cols * rows);
    order.forEach((i, k) => (rank[i] = k));
    for (let i = 0; i < cols * rows; i++) {
      if (down[i] < 0) continue;
      expect(rank[down[i]]).toBeLessThan(rank[i]);
      expect(ground[down[i]]).toBeLessThanOrEqual(ground[i]);
    }
  });
});

describe('accumulate', () => {
  // A little river: 3 and 4 run into 2, 2 into 1, 1 into 0 (the sea).
  const down = Int32Array.of(-1, 0, 1, 2, 2);
  const order = Int32Array.of(0, 1, 2, 3, 4);

  it('gathers the water every hex gives on its way down', () => {
    const out = accumulate(down, order, Float32Array.of(0, 1, 1, 1, 1), new Float32Array(5).fill(1), new Float32Array(5));
    expect(Array.from(out)).toEqual([4, 4, 3, 1, 1]);
  });

  it('passes on only the share of its water a hex lets go: a filling lake holds what reaches it', () => {
    const out = accumulate(down, order, Float32Array.of(0, 0, 0, 1, 1), Float32Array.of(1, 1, 0, 1, 1), new Float32Array(5));
    expect(out[2]).toBe(0);
    expect(out[1]).toBe(0);
  });
});

describe('waterBalance', () => {
  const topo = hexTopology(5, 5, 12);
  const MID = 12;
  const flux = new Float32Array(topo.n * topo.dirs);

  it('counts what a hex gives (more out than in) and the share of its incoming water it lets go', () => {
    flux.fill(0);
    flux[MID * topo.dirs] = 0.05; // the middle sends east…
    const east = pipeTarget(topo, MID, 0);
    flux[east * topo.dirs] = 0.02; // …which passes some on
    const { source, leaving } = waterBalance(topo, flux, new Uint8Array(topo.n));
    expect(source[MID]).toBeCloseTo(0.05);
    expect(leaving[east]).toBeCloseTo(0.4);
  });

  it('counts water passing both ways through a pipe once', () => {
    flux.fill(0);
    flux[MID * topo.dirs] = 0.05;
    flux[pipeTarget(topo, MID, 0) * topo.dirs + opposite(0)] = 0.05;
    expect(waterBalance(topo, flux, new Uint8Array(topo.n)).source[MID]).toBeCloseTo(0);
  });
});

describe('channelStep', () => {
  // A valley running south to the sea: its sides fall towards its middle column.
  const [cols, rows] = [9, 9];
  const topo = hexTopology(cols, rows, 12);
  const sink = edgeSinks(cols, rows);
  const ground = Float32Array.from({ length: cols * rows }, (_, i) => 1 + Math.abs((i % cols) - 4) * 0.6 + (rows - Math.floor(i / cols)) * 0.2);
  /** Flux as if every hex gave `amount` of its own, passing it on with all that reaches it to the hex below it. */
  const giving = (amount: number) => {
    const ch = createChannels(topo);
    const flux = new Float32Array(topo.n * topo.dirs);
    const { down, order } = floodRoute(hexTopology(cols, rows, 6), ground, sink);
    const through = accumulate(down, order, new Float32Array(topo.n).fill(amount), new Float32Array(topo.n).fill(1), new Float32Array(topo.n));
    for (let i = 0; i < topo.n; i++) {
      const d = Array.from({ length: 12 }, (_, d) => d).find((d) => pipeTarget(topo, i, d) === down[i]);
      if (d !== undefined && !sink[i]) flux[i * topo.dirs + d] = through[i];
    }
    return { ch, flux };
  };
  const run = (ch: ReturnType<typeof createChannels>, flux: Float32Array, steps: number) => {
    for (let k = 0; k < steps; k++) channelStep(topo, ground, flux, sink, ch);
    return ch;
  };
  const floor = (row: number) => row * cols + 4;
  const side = (row: number) => row * cols + 1;

  it('gathers the water of the slopes into a river down the valley, growing as it goes', () => {
    const { ch, flux } = giving(0.002);
    run(ch, flux, 60);
    expect(ch.flow[floor(6)]).toBeGreaterThan(ch.flow[floor(2)]);
    expect(ch.flow[floor(6)]).toBeGreaterThan(5 * ch.flow[side(6)]);
  });

  it('wears a bed where the river runs that lasts long after it runs dry, and fades in the end', () => {
    const { ch, flux } = giving(0.002);
    run(ch, flux, 200);
    const worn = ch.bed[floor(6)];
    expect(worn).toBeGreaterThan(0);
    run(ch, new Float32Array(flux.length), 300);
    expect(ch.flow[floor(6)]).toBeLessThan(worn / 50);
    expect(ch.bed[floor(6)]).toBeGreaterThan(worn * 0.6);
    run(ch, new Float32Array(flux.length), 5000);
    expect(ch.bed[floor(6)]).toBeLessThan(worn * 0.1);
  });

  it('runs no river where water leaves the map', () => {
    const { ch, flux } = giving(0.002);
    run(ch, flux, 60);
    expect(ch.flow[cols * (rows - 1) + 4]).toBe(0);
    expect(ch.down[cols * (rows - 1) + 4]).toBe(-1);
  });
});
