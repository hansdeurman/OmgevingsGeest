import { describe, expect, it } from 'vitest';
import { demoMap } from '../../tiles/demoMaps';
import { createWaterWorld, surfaceOf } from '../hexWater';
import { basinScript, basins, phaseEnd, runScript } from '../waterScript';

/**
 * End-to-end: a demo map's dry high basins, run through the basin script.
 * Checks the lakes fill to where rain would fill them, level out after a
 * cloudburst and dry out again.
 */
for (const [id, seed] of [['highlands', 1], ['mountains', 2]] as const) {
  describe(`basin script on ${id} (seed ${seed})`, () => {
    const { grid, water } = demoMap(id, seed);
    const script = basinScript(grid.cols, grid.rows, water!);
    const states = runScript(createWaterWorld(grid.cols, grid.rows, grid.elevation), script);
    const after = (label: string) => phaseEnd(script, label);
    const lakes = basins(grid.cols, grid.rows, water!);
    const fullLevel = (cells: number[]) => grid.elevation[cells[0]] + water![cells[0]];
    const surfaces = (k: number, cells: number[]) => cells.map((i) => surfaceOf(states[k], i));

    it('fills every basin up to the level where it overflows', () => {
      for (const cells of lakes) {
        const s = surfaces(after('Rain'), cells);
        expect(Math.min(...s)).toBeGreaterThan(fullLevel(cells) - 0.15);
        expect(Math.max(...s)).toBeLessThan(fullLevel(cells) + 0.6);
      }
    });

    it('lets a cloudburst on one side level out again', () => {
      const biggest = lakes.reduce((a, b) => (b.length > a.length ? b : a));
      const spread = (k: number) => Math.max(...surfaces(k, biggest)) - Math.min(...surfaces(k, biggest));
      expect(spread(after('Rain') + 1)).toBeGreaterThan(0.3);
      expect(spread(after('Cloudburst, one side'))).toBeLessThan(0.1);
    });

    it('dries every basin out in the drought', () => {
      const end = states[states.length - 1];
      for (const cells of lakes) for (const i of cells) expect(end.depth[i]).toBeLessThan(0.05);
    });
  });
}
