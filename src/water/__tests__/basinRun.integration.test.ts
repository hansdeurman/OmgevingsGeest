import { describe, expect, it } from 'vitest';
import { demoMap } from '../../tiles/demoMaps';
import { hydroWorldOf } from '../../tiles/mapHydro';
import { outflow } from '../pipeFlow';
import { basins, phaseEnd, runScript, seasonScript } from '../waterScript';

/**
 * End-to-end: a demo map's land and dry high basins, run through a year of
 * weather. Checks what a player should be able to count on: lakes fill up to
 * where they overflow, rivers run and keep running a while after the rain,
 * a lake hit on one side levels out, and drought lowers the lakes.
 */
for (const [id, seed] of [['highlands', 1], ['mountains', 2]] as const) {
  describe(`a year of water on ${id} (seed ${seed})`, () => {
    const { grid, water } = demoMap(id, seed);
    const world = hydroWorldOf(grid);
    const script = seasonScript(grid.cols, grid.rows, grid.elevation, water!);
    const states = runScript(world, script);
    const after = (label: string) => phaseEnd(script, label);
    const lakes = basins(grid.cols, grid.rows, water!);
    const fullLevel = (cells: number[]) => grid.elevation[cells[0]] + water![cells[0]];
    const surfaces = (k: number, cells: number[]) => cells.map((i) => grid.elevation[i] + states[k].depth[i]);
    const held = (k: number) => lakes.flat().reduce((s, i) => s + states[k].depth[i], 0);
    const running = (k: number, min: number) => [...grid.cells.keys()].filter((i) => outflow(world.topo, states[k].flux, i) > min).length;

    it('lays snow on the heights in winter, and keeps the basins dry until it rains', () => {
      const high = [...grid.elevation.keys()].filter((i) => grid.elevation[i] > 6.5);
      expect(high.every((i) => states[after('Winter')].snow[i] > 0)).toBe(true);
      expect(held(after('Winter'))).toBeLessThan(0.1);
    });

    it('fills every basin to close below where it overflows, at some time of the year', () => {
      for (const cells of lakes) {
        const highest = Math.max(...states.map((_, k) => Math.min(...surfaces(k, cells))));
        expect(highest).toBeGreaterThan(fullLevel(cells) - 0.3);
      }
    });

    it('runs rivers in the rain, and keeps them running a while after it stops', () => {
      expect(running(after('Spring rain'), 0.01)).toBeGreaterThan(3);
      expect(running(after('Cloudburst, one side') + 20, 0.004)).toBeGreaterThan(0);
    });

    it('lets a cloudburst on one side level out again', () => {
      const biggest = lakes.reduce((a, b) => (b.length > a.length ? b : a));
      const spread = (k: number) => Math.max(...surfaces(k, biggest)) - Math.min(...surfaces(k, biggest));
      expect(spread(after('Spring rain') + 1)).toBeGreaterThan(0.3);
      expect(spread(after('Cloudburst, one side'))).toBeLessThan(0.1);
    });

    it('lowers the lakes in the dry summer', () => {
      expect(held(after('Dry summer'))).toBeLessThan(held(after('Cloudburst, one side')));
    });
  });
}
