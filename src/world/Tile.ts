/**
 * A single hex tile. Properties are added incrementally as new simulation
 * layers come online (moisture, temperature, biome, …). Anything specific to
 * a layer should live on this struct so the renderer can read it directly.
 */
export interface Tile {
  col: number;
  row: number;
  /** Normalised elevation in [0, 1] sampled at the cell's *centre*. */
  height: number;
  /**
   * Optional heights sampled at the cell's six geometric corners (in the
   * order produced by `hexCorners`). When present, the renderer uses these
   * directly instead of averaging neighbour cell heights — this lets
   * features like a thin straight wall keep a clean edge instead of
   * inheriting the hex-cell zigzag of plain centre sampling.
   */
  cornerHeights?: Float32Array;
}

export function createTile(col: number, row: number): Tile {
  return { col, row, height: 0 };
}
