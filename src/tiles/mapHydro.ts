import { createHydroWorld, type HydroWorld } from '../water/hydroWorld';
import { hardnessOf } from '../water/erosion';
import { glacierOf, soakOf } from '../water/retention';
import type { CoverGrid } from './coverGrid';

/** A map's water world: its ground holding water (and holding together) by its grass and trees, glaciers on its highest peaks, its basins dry. */
export function hydroWorldOf(grid: CoverGrid, dirs: 6 | 12 = 12): HydroWorld {
  const { cols, rows, cells, elevation } = grid;
  return createHydroWorld({
    cols,
    rows,
    dirs,
    ground: elevation,
    soak: (i) => soakOf(cells[i].grass, cells[i].trees, elevation[i]),
    snow: (i) => glacierOf(elevation[i]),
    hardness: (i) => hardnessOf(cells[i].grass, cells[i].trees, elevation[i]),
  });
}
