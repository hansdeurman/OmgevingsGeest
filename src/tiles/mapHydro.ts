import { createHydroWorld, type HydroWorld } from '../water/hydroWorld';
import { hardnessOf } from '../water/erosion';
import { glacierOf, soakOf } from '../water/retention';
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
