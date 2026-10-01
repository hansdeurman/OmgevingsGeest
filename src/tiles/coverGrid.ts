import type { Cover } from './levels';

/** Row-major grid of per-hex cover and elevation, in the same odd-r layout as the world. */
export interface CoverGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cells: Cover[];
  /** Terrace steps above sea level, per cell. */
  readonly elevation: number[];
}

export type CellInit = Partial<Cover> & { elevation?: number };

export function createCoverGrid(
  cols: number,
  rows: number,
  init: (col: number, row: number) => CellInit = () => ({}),
): CoverGrid {
  const cells: Cover[] = [];
  const elevation: number[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const { elevation: e = 0, ...cover } = init(col, row);
      cells.push({ water: 0, grass: 0, trees: 0, ...cover });
      elevation.push(e);
    }
  }
  return { cols, rows, cells, elevation };
}

export function inGrid(grid: CoverGrid, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < grid.cols && row < grid.rows;
}

export function coverAt(grid: CoverGrid, col: number, row: number): Cover | undefined {
  return inGrid(grid, col, row) ? grid.cells[row * grid.cols + col] : undefined;
}

export function elevationAt(grid: CoverGrid, col: number, row: number): number {
  return inGrid(grid, col, row) ? grid.elevation[row * grid.cols + col] : 0;
}

export function forEachCell(
  grid: CoverGrid,
  fn: (cover: Cover, col: number, row: number, elevation: number) => void,
): void {
  grid.cells.forEach((cover, i) => fn(cover, i % grid.cols, Math.floor(i / grid.cols), grid.elevation[i]));
}
