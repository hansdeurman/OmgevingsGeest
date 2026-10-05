import { describe, expect, it } from 'vitest';
import { createHydroWorld, type HydroSnapshot } from '../hydroWorld';
import { soakOf } from '../retention';
import { createRun, createWaterRun } from '../waterRun';
import { runScript, scriptLength, type WaterScript } from '../waterScript';

/** A sloping 6x5 map with a hollow, meadow soaking up rain. */
const cols = 6;
const ground = Array.from({ length: 30 }, (_, i) => 1 + (i % cols) * 0.4 - (i === 14 ? 0.8 : 0));
const world = () => createHydroWorld({ cols, rows: 5, ground, soak: () => soakOf(3, 1, 1), soil: () => 0.1 });
const script: WaterScript = [
  { label: 'rain', steps: 30, rain: 0.02, warmth: 0.5, evaporation: 0 },
  { label: 'burst', steps: 20, rain: 0, warmth: 0.8, evaporation: 0.01, burst: Float32Array.from({ length: 30 }, (_, i) => (i === 8 ? 1 : 0)) },
  { label: 'dry', steps: 30, rain: 0, warmth: 1, evaporation: 0.01 },
];
const reference = runScript(world(), script);
const same = (a: HydroSnapshot, b: HydroSnapshot) => {
  for (const k of ['depth', 'ground', 'wetness'] as const) expect(Array.from(a[k])).toEqual(Array.from(b[k]));
  expect(Array.from(a.river.bed)).toEqual(Array.from(b.river.bed));
  expect(Array.from(a.river.down)).toEqual(Array.from(b.river.down));
};

describe('createWaterRun', () => {
  it('knows how many steps its script has', () => {
    expect(createWaterRun(world(), script).length).toBe(scriptLength(script));
  });

  it('plays step after step exactly as running the whole script would', () => {
    const run = createWaterRun(world(), script);
    for (let k = 0; k <= scriptLength(script); k++) same(run.at(k), reference[k]);
  });

  it('jumps ahead, and back, to the same moments', () => {
    const run = createWaterRun(world(), script, 10);
    for (const k of [70, 3, 45, 44, 80, 0, 21]) same(run.at(k), reference[k]);
  });

  it('keeps only a moment every so many steps, not every step', () => {
    const run = createWaterRun(world(), script, 10);
    run.at(scriptLength(script));
    expect(run.kept).toBeLessThanOrEqual(scriptLength(script) / 10 + 1);
  });

  it('holds the last moment past the end', () => {
    same(createWaterRun(world(), script).at(999), reference[scriptLength(script)]);
  });
});

describe('createRun', () => {
  /** A counter as a model: its view is how many steps it took. */
  const counter = () => {
    let n = 0;
    return { step: () => void n++, save: () => n, restore: (s: number) => void (n = s), view: () => n };
  };

  it('runs on without end when given no length', () => {
    const run = createRun(counter());
    expect(run.length).toBe(Infinity);
    expect(run.at(5000)).toBe(5000);
  });

  it('keeps at most so many moments, dropping the oldest, and goes back no further than it holds', () => {
    const run = createRun(counter(), Infinity, 10, 5);
    run.at(200);
    expect(run.kept).toBe(5);
    expect(run.first).toBe(160);
    expect(run.at(0)).toBe(160);
    expect(run.at(173)).toBe(173);
    expect(run.at(250)).toBe(250);
    expect(run.first).toBe(210);
  });
});
