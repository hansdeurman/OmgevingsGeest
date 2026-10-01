import type { Cover } from './levels';

/** Row-major grid of per-hex cover, in the same odd-r layout as the world. */
export interface CoverGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cells: Cover[];
}

export function createCoverGrid(
  cols: number,
  rows: number,
  init: (col: number, row: number) => Partial<Cover> = () => ({}),
): CoverGrid {
  const cells: Cover[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cells.push({ water: 0, grass: 0, trees: 0, ...init(col, row) });
    }
  }
  return { cols, rows, cells };
}

export function inGrid(grid: CoverGrid, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < grid.cols && row < grid.rows;
}

export function coverAt(grid: CoverGrid, col: number, row: number): Cover | undefined {
  return inGrid(grid, col, row) ? grid.cells[row * grid.cols + col] : undefined;
}

export function forEachCell(
  grid: CoverGrid,
  fn: (cover: Cover, col: number, row: number) => void,
): void {
  grid.cells.forEach((cover, i) => fn(cover, i % grid.cols, Math.floor(i / grid.cols)));
}
