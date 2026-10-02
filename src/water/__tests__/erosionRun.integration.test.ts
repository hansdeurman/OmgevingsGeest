import { describe, expect, it } from 'vitest';
import { demoMap } from '../../tiles/demoMaps';
import { hydroWorldOf } from '../../tiles/mapHydro';
import { runScript, seasonScript } from '../waterScript';

/**
 * End-to-end: years of weather on a demo map. Running water should cut into
 * the land where it runs hard, and leave the rest of the land alone.
 */
describe('years of water wearing the land (mountains, seed 2)', () => {
  const { grid, water } = demoMap('mountains', 2);
  const world = hydroWorldOf(grid);
  const states = runScript(world, seasonScript(grid.cols, grid.rows, grid.elevation, water!, 3));
  const end = states[states.length - 1].ground;
  const change = [...grid.elevation.keys()].filter((i) => !world.sink[i]).map((i) => end[i] - grid.elevation[i]);

  it('cuts into the land where water runs hard', () => {
    expect(Math.min(...change)).toBeLessThan(-0.05);
  });

  it('leaves most of the land nearly as it was: autumn storms wear only a film off it', () => {
    const sorted = change.map(Math.abs).sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThan(0.025);
  });

  it('wears gradually: nowhere more than a step in three years', () => {
    expect(Math.min(...change)).toBeGreaterThan(-1);
  });
});
