import { offsetNeighbours, offsetToPixel } from '../math/hex';
import { hash2 } from '../math/noise';
import type { CoverGrid } from './coverGrid';
import type { PropKind } from './propRules';
import type { PropInstance } from './scatter';

/**
 * Mountains as chains: a mountain sprite on every high, dry cell, and one on
 * the edge between every two neighbouring high cells, so a range reads as one
 * continuous wall. Gaps only appear where the ground really is lower (a pass),
 * or where water runs, so the picture never suggests water can slip between
 * two peaks when the height map says it cannot.
 */

/** Elevation (steps) from which a cell carries a mountain. */
export const RIDGE_FROM = 4.5;
/** Random offset of a sprite from its spot, in hex radii. */
const JITTER = 0.12;

const kindFor = (e: number): PropKind => (e < 5.5 ? 'hill' : e < 6.5 ? 'crag' : 'peak');

/** Ridge sprites in grid-local pixels; `blocked` cells (rivers) stay free. */
export function ridgeProps(grid: CoverGrid, size: number, seed: number, blocked: ReadonlySet<number> = new Set()): PropInstance[] {
  const { cols, rows } = grid;
  const high = (c: number, r: number) => {
    if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
    const i = r * cols + c;
    return grid.elevation[i] >= RIDGE_FROM && grid.cells[i].water === 0 && !blocked.has(i);
  };
  const props: PropInstance[] = [];
  const place = (kind: PropKind, x: number, y: number, col: number, row: number, a: number, b: number) => {
    const jx = (hash2(a, b, seed) - 0.5) * 2 * JITTER * size;
    const jy = (hash2(b, a, seed) - 0.5) * 2 * JITTER * size;
    props.push({ kind, variant: Math.floor(hash2(a, b, seed + 1) * 1000), x: x + jx, y: y + jy, col, row });
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!high(c, r)) continue;
      const i = r * cols + c;
      const p = offsetToPixel(c, r, size);
      place(kindFor(grid.elevation[i]), p.x, p.y, c, r, i, i);
      for (const d of offsetNeighbours(r)) {
        const [nc, nr] = [c + d.dc, r + d.dr];
        const j = nr * cols + nc;
        if (j <= i || !high(nc, nr)) continue; // each link once
        const q = offsetToPixel(nc, nr, size);
        place(kindFor(Math.min(grid.elevation[i], grid.elevation[j])), (p.x + q.x) / 2, (p.y + q.y) / 2, c, r, i, j);
      }
    }
  }
  return props;
}
