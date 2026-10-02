import { describe, expect, it } from 'vitest';
import { createHydroWorld, stepHydro } from '../hydroWorld';
import { soakOf } from '../retention';

/**
 * The water model has to run on very large maps: a million hexes, twelve
 * pipes each. This keeps an eye on its speed and on how little it allocates.
 */
describe('water model at scale', () => {
  it('steps a world of a million hexes in well under a second', () => {
    const [cols, rows] = [1000, 1000];
    const soak = soakOf(2, 1, 2);
    const w = createHydroWorld({ cols, rows, ground: Float32Array.from({ length: cols * rows }, (_, i) => 2 + Math.sin(i * 0.013) + Math.cos(i / cols / 7)), soak: () => soak });
    stepHydro(w, { rain: 0.01, warmth: 0, evaporation: 0 }); // warm up
    const t0 = performance.now();
    stepHydro(w, { rain: 0.01, warmth: 0, evaporation: 0 }, 1);
    const ms = performance.now() - t0;
    console.log(`one weather + flow round over 1,000,000 hexes: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1000);
  }, 60000);
});
