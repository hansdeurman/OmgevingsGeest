import { describe, expect, it } from 'vitest';
import { airStep, carry, createAir, DEFAULT_AIR, saturation, type Sky } from '../atmosphere';
import { totalWater } from '../hydroWorld';
import { temperature } from '../retention';

const flat = (cols: number, rows: number, h = 1) => new Float32Array(cols * rows).fill(h);
const noSea = (n: number) => new Uint8Array(n);
const calm: Sky = { warmth: 0, wind: { x: 0, y: 0 } };
/** Where the water in `q` sits on average, in columns (x) and rows (y). */
const centroid = (q: Float32Array, cols: number) => {
  let [x, y, sum] = [0, 0, 0];
  q.forEach((v, i) => ((x += v * (i % cols)), (y += v * Math.floor(i / cols)), (sum += v)));
  return { x: x / sum, y: y / sum };
};

describe('saturation', () => {
  it('lets warm air hold more water than cold air', () => {
    expect(saturation(15)).toBeGreaterThan(saturation(5));
    expect(saturation(5)).toBeGreaterThan(saturation(-5));
  });
});

describe('carry', () => {
  const [cols, rows] = [16, 12];
  const blob = () => Float32Array.from({ length: cols * rows }, (_, i) => (Math.abs((i % cols) - 6) < 2 && Math.abs(Math.floor(i / cols) - 6) < 2 ? 1 : 0));

  it('leaves the air where it is without wind', () => {
    const air = createAir(cols, rows, flat(cols, rows), noSea(cols * rows));
    const q = blob();
    carry(air, q, { x: 0, y: 0 }, 0);
    expect(q).toEqual(blob());
  });

  it('drifts with the wind and loses nothing on the way', () => {
    const air = createAir(cols, rows, flat(cols, rows), noSea(cols * rows));
    const q = blob();
    const before = centroid(q, cols);
    for (let k = 0; k < 6; k++) carry(air, q, { x: 0.4, y: 0 }, 0);
    const after = centroid(q, cols);
    expect(totalWater(q)).toBeCloseTo(totalWater(blob()), 2);
    expect(after.x - before.x).toBeGreaterThan(1.5);
    expect(Math.abs(after.y - before.y)).toBeLessThan(0.2);
  });

  it('drifts south with a wind from the north', () => {
    const air = createAir(cols, rows, flat(cols, rows), noSea(cols * rows));
    const q = blob();
    for (let k = 0; k < 4; k++) carry(air, q, { x: 0, y: 0.4 }, 0);
    expect(centroid(q, cols).y).toBeGreaterThan(centroid(blob(), cols).y + 1);
  });

  it('brings air in from beyond the edge the wind comes from, and lets it go at the other', () => {
    const air = createAir(cols, rows, flat(cols, rows), noSea(cols * rows));
    const q = new Float32Array(cols * rows);
    for (let k = 0; k < 200; k++) carry(air, q, { x: 0.4, y: 0 }, 0.5);
    expect(q[6 * cols]).toBeCloseTo(0.5, 2);
    expect(q[6 * cols + cols - 1]).toBeCloseTo(0.5, 2);
  });

  it('is held back by rising ground: air piles up in front of a ridge', () => {
    const ground = Float32Array.from({ length: cols * rows }, (_, i) => (i % cols >= 8 ? 6 : 0));
    const air = createAir(cols, rows, ground, noSea(cols * rows));
    const q = new Float32Array(cols * rows);
    for (let k = 0; k < 200; k++) carry(air, q, { x: 0.4, y: 0 }, 0.5);
    expect(q[6 * cols + 7]).toBeGreaterThan(0.6);
    expect(q[6 * cols + 12]).toBeLessThan(q[6 * cols + 7]);
  });
});

describe('airStep', () => {
  it('moistens dry air over the sea', () => {
    const [cols, rows] = [8, 8];
    const air = createAir(cols, rows, flat(cols, rows, 0), new Uint8Array(cols * rows).fill(1));
    for (let k = 0; k < 100; k++) airStep(air, calm);
    const target = DEFAULT_AIR.seaHumidity * saturation(5);
    expect(air.vapour[27]).toBeGreaterThan(0.9 * target);
    expect(air.vapour[27]).toBeLessThan(1.01 * target);
  });

  it('takes up what rose from the land', () => {
    const [cols, rows] = [6, 6];
    const air = createAir(cols, rows, flat(cols, rows), noSea(36));
    air.rise[14] = 0.01;
    airStep(air, calm);
    expect(totalWater(air.vapour) + totalWater(air.cloud)).toBeCloseTo(0.01, 6);
    expect(air.rise[14]).toBe(0);
  });

  it('turns too much vapour into cloud, and clouds over warm, dry land back into vapour, losing nothing', () => {
    const [cols, rows] = [6, 6];
    const air = createAir(cols, rows, flat(cols, rows), noSea(36));
    air.vapour[14] = 3 * saturation(5);
    air.cloud[21] = 0.01;
    const total = () => totalWater(air.vapour) + totalWater(air.cloud);
    const start = total();
    let fell = 0;
    for (let k = 0; k < 10; k++) {
      airStep(air, calm);
      fell += totalWater(air.fall);
    }
    expect(air.cloud[14]).toBeGreaterThan(0);
    expect(air.cloud[21]).toBeLessThan(0.01);
    expect(total() + fell).toBeCloseTo(start, 4);
  });

  it('lets heavy clouds rain, and what falls is what the clouds lost', () => {
    const [cols, rows] = [6, 6];
    const air = createAir(cols, rows, flat(cols, rows), noSea(36));
    air.vapour.fill(saturation(temperature(1, 0)));
    air.cloud[14] = 0.3;
    airStep(air, calm);
    expect(air.fall[14]).toBeGreaterThan(0);
    expect(air.cloud[14] + air.fall[14]).toBeCloseTo(0.3, 4);
    expect(air.fall[0]).toBe(0);
  });

  it('holds less where weather systems lift the air', () => {
    const [cols, rows] = [6, 6];
    const air = createAir(cols, rows, flat(cols, rows), noSea(36));
    air.vapour.fill(0.95 * saturation(temperature(1, 0)));
    const lift = new Float32Array(36);
    lift[14] = 1;
    airStep(air, { ...calm, lift });
    expect(air.cloud[14]).toBeGreaterThan(0);
    expect(air.cloud[0]).toBe(0);
  });

  it('rains on the windward side of a range of mountains, far less on the lowland before it and in its lee', () => {
    // Sea in the west, lowland, a ridge in the middle, lowland behind it; the wind blows from the sea.
    const [cols, rows] = [24, 8];
    const ridge = (c: number) => Math.max(0, 7 - Math.abs(c - 12) * 1.4);
    const ground = Float32Array.from({ length: cols * rows }, (_, i) => (i % cols < 4 ? 0 : Math.max(0.5, ridge(i % cols))));
    const sea = Uint8Array.from(ground, (g) => (g <= 0 ? 1 : 0));
    const air = createAir(cols, rows, ground, sea);
    const fell = new Float32Array(cols);
    for (let k = 0; k < 400; k++) {
      airStep(air, { warmth: 0.5, wind: { x: 0.35, y: 0 } });
      if (k >= 200) air.fall.forEach((f, i) => (fell[i % cols] += f));
    }
    const mean = (from: number, to: number) => fell.slice(from, to).reduce((a, b) => a + b, 0) / (to - from);
    const [lowland, windward, lee] = [mean(4, 7), mean(9, 13), mean(15, 20)];
    expect(windward).toBeGreaterThan(3 * lowland);
    expect(windward).toBeGreaterThan(3 * lee);
  });
});
