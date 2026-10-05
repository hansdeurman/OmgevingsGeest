import { describe, expect, it } from 'vitest';
import { advect, carry, divergence, gradient, mix, neighbours } from '../airGrid';
import { hexTopology, pipeTarget } from '../hexTopology';
import { totalWater } from '../hydroWorld';

const [cols, rows] = [16, 12];
const topo = hexTopology(cols, rows, 6);
const n = cols * rows;
/** Map position of hex i, in hex spacings. */
const at = (i: number) => ({ x: (i % cols) + (Math.floor(i / cols) & 1) / 2, y: (Math.floor(i / cols) * Math.sqrt(3)) / 2 });
const field = (f: (x: number, y: number) => number) => Float32Array.from({ length: n }, (_, i) => f(at(i).x, at(i).y));
const blob = () => field((x, y) => (Math.hypot(x - 6, y - 5) < 1.6 ? 1 : 0));
const uniform = (v: number) => new Float32Array(n).fill(v);
const centroid = (q: Float32Array) => {
  let [x, y, s] = [0, 0, 0];
  q.forEach((v, i) => ((x += v * at(i).x), (y += v * at(i).y), (s += v)));
  return { x: x / s, y: y / s };
};
const inner = 5 * cols + 7;

describe('neighbours', () => {
  it('lists each hex its six neighbours, wrapping around the map\'s edges', () => {
    const nb = neighbours(topo);
    for (let d = 0; d < 6; d++) expect(nb[inner * 6 + d]).toBe(pipeTarget(topo, inner, d));
    const east = 3 * cols + cols - 1;
    expect(nb[east * 6]).toBe(3 * cols); // east of the east edge: the west edge
    for (let i = 0; i < n; i++) for (let d = 0; d < 6; d++) expect(nb[nb[i * 6 + d] * 6 + ((d + 3) % 6)]).toBe(i);
  });
});

describe('gradient and divergence', () => {
  it('find the slope of a field rising eastward and southward', () => {
    const [gx, gy] = [new Float32Array(n), new Float32Array(n)];
    gradient(topo, field((x, y) => 2 * x + y), gx, gy);
    expect(gx[inner]).toBeCloseTo(2, 4);
    expect(gy[inner]).toBeCloseTo(1, 4);
  });

  it('find wind spreading out as divergence and wind closing in as convergence', () => {
    const out = new Float32Array(n);
    divergence(topo, field((x) => 0.1 * (x - 7)), uniform(0), out);
    expect(out[inner]).toBeCloseTo(0.1, 4);
    divergence(topo, uniform(0), field((_, y) => -0.2 * y), out);
    expect(out[inner]).toBeCloseTo(-0.2, 4);
  });
});

describe('carry', () => {
  it('drifts with the wind and loses nothing, off one edge of the map and back on at the other', () => {
    const q = blob();
    const start = totalWater(q);
    const before = centroid(q);
    const [ux, uy] = [uniform(0.4), uniform(0)];
    for (let k = 0; k < 6; k++) carry(topo, q, ux, uy);
    expect(centroid(q).x - before.x).toBeGreaterThan(1.5);
    for (let k = 0; k < 200; k++) carry(topo, q, ux, uy);
    expect(totalWater(q)).toBeCloseTo(start, 3);
  });

  it('gathers what the wind brings together where it closes in', () => {
    const q = uniform(1);
    const ux = field((x) => -0.1 * (x - 7));
    for (let k = 0; k < 10; k++) carry(topo, q, ux, uniform(0));
    expect(q[inner]).toBeGreaterThan(1.2);
    expect(totalWater(q)).toBeCloseTo(n, 2);
  });

  it('is held back by rising ground', () => {
    const floor = field((x) => (x >= 8 ? 6 : 0));
    const [free, held] = [blob(), blob()];
    for (let k = 0; k < 8; k++) {
      carry(topo, free, uniform(0.4), uniform(0));
      carry(topo, held, uniform(0.4), uniform(0), floor, 0.4);
    }
    expect(centroid(held).x).toBeLessThan(centroid(free).x);
  });
});

describe('advect', () => {
  it('moves a temperature with the wind without changing an even one', () => {
    const t = blob();
    const out = new Float32Array(n);
    for (let k = 0; k < 6; k++) {
      advect(topo, t, uniform(0), uniform(0.3), out);
      t.set(out);
    }
    expect(centroid(t).y).toBeGreaterThan(centroid(blob()).y + 1);
    const even = uniform(5);
    advect(topo, even, field((x) => 0.3 * Math.sin(x)), uniform(0.2), out);
    expect(Array.from(out).every((v) => Math.abs(v - 5) < 1e-5)).toBe(true);
  });
});

describe('mix', () => {
  it('evens differences out, keeping the total', () => {
    const t = uniform(0);
    t[inner] = 1;
    mix(topo, t, 0.2, new Float32Array(n));
    expect(t[inner]).toBeCloseTo(0.8, 5);
    expect(t[inner + 1]).toBeCloseTo(0.2 / 6, 5);
    expect(totalWater(t)).toBeCloseTo(1, 5);
  });
});
