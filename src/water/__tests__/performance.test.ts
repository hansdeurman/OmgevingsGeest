import { describe, expect, it } from 'vitest';
import { channelStep } from '../channels';
import { erodeStep } from '../erosion';
import { createHydroWorld, stepHydro } from '../hydroWorld';
import { flowStep } from '../pipeFlow';
import { soakOf, weatherStep } from '../retention';

/**
 * The water model has to run on very large maps: a million hexes, twelve
 * pipes each. This keeps an eye on its speed and on how little it allocates.
 */
describe('water model at scale', () => {
  const [cols, rows] = [1000, 1000];
  const soak = soakOf(2, 1, 2);
  const rain = { rain: 0.01, warmth: 0, evaporation: 0 };
  const w = createHydroWorld({ cols, rows, ground: Float32Array.from({ length: cols * rows }, (_, i) => 2 + Math.sin(i * 0.013) + Math.cos(i / cols / 7)), soak: () => soak });
  stepHydro(w, rain); // warm up
  /** The best of three runs: other tests running alongside only ever slow it down. */
  const timed = (label: string, f: () => void) => {
    const ms = Math.min(
      ...[0, 1, 2].map(() => {
        const t0 = performance.now();
        f();
        return performance.now() - t0;
      }),
    );
    console.log(`${label} over 1,000,000 hexes: ${ms.toFixed(0)} ms`);
    return ms;
  };

  it('steps the weather and a round of flow over a million hexes in well under a second', () => {
    const ms = timed('one weather + flow round', () => {
      weatherStep(w.ground, w.depth, w.soil, w.snow, w.soak, rain);
      flowStep(w.topo, w.ground, w.depth, w.flux, w.sink);
      erodeStep(w.topo, w.ground, w.depth, w.flux, w.sediment, w.hardness, w.sink);
    });
    expect(ms).toBeLessThan(1000);
  }, 60000);

  it('keeps track of the rivers of a million hexes at a fraction of that', () => {
    expect(timed('rivers', () => channelStep(w.topo, w.ground, w.flux, w.sink, w.channels))).toBeLessThan(400);
  }, 60000);
});
