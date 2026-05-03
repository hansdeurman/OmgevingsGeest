/**
 * A single hex tile. Properties are added incrementally as new simulation
 * layers come online (moisture, temperature, biome, …). Anything specific to
 * a layer should live on this struct so the renderer can read it directly.
 */
export interface Tile {
  col: number;
  row: number;
  /** Normalised elevation in [0, 1]. */
  height: number;
}

export function createTile(col: number, row: number): Tile {
  return { col, row, height: 0 };
}
