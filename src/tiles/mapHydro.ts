import { createHydroWorld, type HydroWorld } from '../water/hydroWorld';
import { hardnessOf } from '../water/erosion';
import { albedoOf, ALBEDO } from '../water/heat';
import { glacierOf, soakOf } from '../water/retention';
import type { GroundCover } from '../water/waterCycle';
import { ROUGH, roughnessOf } from '../water/wind';
import type { CoverGrid } from './coverGrid';

/** Share of what its ground can hold that a hex holds at the start: ordinary, neither dry nor wet. */
const START_FILL = 0.55;

/** A map's water world: its ground holding water (and holding together) by its grass and trees, half full, glaciers on its highest peaks, its basins dry (or holding `water`). */
export function hydroWorldOf(grid: CoverGrid, dirs: 6 | 12 = 12, water?: ArrayLike<number>): HydroWorld {
  const { cols, rows, cells, elevation } = grid;
  return createHydroWorld({
    cols,
    rows,
    dirs,
    ground: elevation,
    depth: water && ((i) => water[i] ?? 0),
    soak: (i) => soakOf(cells[i].grass, cells[i].trees, elevation[i]),
    soil: (i) => START_FILL * soakOf(cells[i].grass, cells[i].trees, elevation[i]).capacity,
    snow: (i) => glacierOf(elevation[i]),
    hardness: (i) => hardnessOf(cells[i].grass, cells[i].trees, elevation[i]),
  });
}

/** How bright and how rough a map's ground is, per hex, by its grass, trees and height; the sea dark and smooth. */
export function groundCoverOf(grid: CoverGrid): GroundCover {
  const { cells, elevation } = grid;
  const sea = (i: number) => elevation[i] <= 0;
  return {
    albedo: Float32Array.from(cells, (c, i) => (sea(i) ? ALBEDO.sea : albedoOf(c.grass, c.trees, elevation[i]))),
    rough: Float32Array.from(cells, (c, i) => (sea(i) ? ROUGH.sea : roughnessOf(c.trees, elevation[i]))),
  };
}
