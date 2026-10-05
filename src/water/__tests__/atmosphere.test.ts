import { describe, expect, it } from 'vitest';
import { airDemand, airStep, createAir, DEFAULT_AIR, saturation, type Sky } from '../atmosphere';
import { totalWater } from '../hydroWorld';
import { LAPSE } from '../retention';

/** A sky over `heights`: air at `sea` degrees at sea level (LAPSE colder per step up), surfaces as warm as their air, wind (x, y) everywhere. */
const sky = (heights: ArrayLike<number>, sea = 8, x = 0, y = 0): Sky & { windX: Float32Array; windY: Float32Array } => {
  const temperature = Float32Array.from(heights, (h) => sea - LAPSE * Math.max(0, h));
  return { temperature, surface: temperature, windX: new Float32Array(heights.length).fill(x), windY: new Float32Array(heights.length).fill(y) };
};
const flat = (cols: number, rows: number, h = 1) => new Float32Array(cols * rows).fill(h);
const noSea = (n: number) => new Uint8Array(n);
const water = (air: ReturnType<typeof createAir>) => totalWater(air.vapour) + totalWater(air.cloud);

describe('saturation', () => {
  it('lets warm air hold more water than cold air', () => {
    expect(saturation(15)).toBeGreaterThan(saturation(5));
    expect(saturation(5)).toBeGreaterThan(saturation(-5));
  });
});

describe('airDemand', () => {
  it('asks more of warm water under dry, windy air', () => {
    const air = createAir(3, 1, [0, 0, 0], new Uint8Array(3).fill(1));
    air.vapour.set([0.1, 0.1, 0.4]);
    const s = sky([0, 0, 0], 12);
    s.windX[1] = 0.5;
    airDemand(air, s);
    expect(air.demand[1]).toBeGreaterThan(air.demand[0]);
    expect(air.demand[0]).toBeGreaterThan(air.demand[2]);
    const cold = createAir(3, 1, [0, 0, 0], new Uint8Array(3).fill(1));
    cold.vapour.set([0.1, 0.1, 0.4]);
    airDemand(cold, sky([0, 0, 0], 2));
    expect(cold.demand[0]).toBeLessThan(air.demand[0]);
  });
});

describe('airStep', () => {
  it('takes up what rose from the land, and loses nothing as the wind blows it against the closed edge of the map', () => {
    const [cols, rows] = [10, 6];
    const n = cols * rows;
    const air = createAir(cols, rows, flat(cols, rows), noSea(n));
    air.rise[25] = 0.05;
    let fell = 0;
    for (let k = 0; k < 100; k++) {
      airStep(air, sky(flat(cols, rows), 20, 0.4));
      fell += totalWater(air.fall);
    }
    expect(water(air) + fell).toBeCloseTo(0.05, 6);
    expect(air.evaporated[25]).toBe(0);
  });

  it('draws water from the sea, as much as the air over it takes', () => {
    const air = createAir(4, 4, flat(4, 4, 0), new Uint8Array(16).fill(1));
    const s = sky(flat(4, 4, 0), 10);
    airDemand(air, s);
    const drawn = airStep(air, s);
    expect(drawn).toBeGreaterThan(0);
    expect(water(air) + totalWater(air.fall)).toBeCloseTo(drawn, 6);
    expect(totalWater(air.evaporated)).toBeCloseTo(drawn, 6);
  });

  it('turns too much vapour into cloud and clouds in dry air back into vapour, telling how much condensed', () => {
    const air = createAir(6, 6, flat(6, 6), noSea(36));
    air.vapour[14] = 3 * saturation(8);
    air.cloud[21] = 0.03;
    const start = water(air);
    airStep(air, sky(flat(6, 6), 8));
    expect(air.condensed[14]).toBeGreaterThan(0);
    expect(air.condensed[21]).toBeLessThan(0);
    expect(water(air) + totalWater(air.fall)).toBeCloseTo(start, 5);
  });

  it('lets heavy clouds rain or snow', () => {
    const air = createAir(6, 6, flat(6, 6), noSea(36));
    air.vapour.fill(saturation(8 - LAPSE));
    air.cloud[14] = 0.3;
    airStep(air, sky(flat(6, 6), 8));
    expect(air.fall[14]).toBeGreaterThan(0);
    expect(air.fall[0]).toBe(0);
  });

  it('makes clouds where the wind closes in and clears them where it spreads out', () => {
    const [cols, rows] = [12, 5];
    const n = cols * rows;
    const air = createAir(cols, rows, flat(cols, rows), noSea(n));
    air.vapour.fill(0.97 * saturation(8 - LAPSE));
    const s = sky(flat(cols, rows), 8);
    // Wind toward column 4 from both sides, and away from column 9.
    const xOf = (i: number) => (i % cols) + (Math.floor(i / cols) & 1) / 2;
    s.windX.set(Array.from({ length: n }, (_, i) => 0.25 * Math.sin(((xOf(i) - 4) * Math.PI) / 5) * -1));
    for (let k = 0; k < 3; k++) airStep(air, s);
    const at = (c: number) => air.cloud[2 * cols + c];
    expect(at(4)).toBeGreaterThan(0.005);
    expect(at(9)).toBeLessThan(at(4) / 5);
  });

  it('rains humid air out on the windward side of a range of mountains, far less on the lowland before it and in its lee', () => {
    // Humid air over lowland and a ridge in the middle, blown east; measured before it piles up against the map's far edge.
    const [cols, rows] = [30, 8];
    const ridge = (c: number) => Math.max(0, 7 - Math.abs(c - 15) * 1.4);
    const ground = Float32Array.from({ length: cols * rows }, (_, i) => Math.max(0.5, ridge(i % cols)));
    const air = createAir(cols, rows, ground, noSea(cols * rows));
    const s = sky(ground, 12, 0.35);
    air.vapour.fill(0.92 * saturation(12));
    const fell = new Float32Array(cols);
    for (let k = 0; k < 40; k++) {
      airStep(air, s);
      air.fall.forEach((f, i) => (fell[i % cols] += f));
    }
    const mean = (from: number, to: number) => fell.slice(from, to).reduce((a, b) => a + b, 0) / (to - from);
    const [lowland, windward, lee] = [mean(3, 8), mean(11, 15), mean(17, 22)];
    expect(windward).toBeGreaterThan(0);
    expect(windward).toBeGreaterThan(3 * lowland);
    expect(windward).toBeGreaterThan(3 * lee);
  });

  it('keeps defaults that let clouds rain only once thick', () => {
    expect(DEFAULT_AIR.rainFrom).toBeGreaterThan(0);
  });
});
