import { offsetNeighbours, offsetToPixel, type Pixel } from '../math/hex';
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

/**
 * Ridge sprites in grid-local pixels: one per high dry (or damp) cell, one on
 * every edge between two of them and one in the middle of every three of them
 * (so no bare floor shows between peaks). Each carries the elevation it
 * stands for, so water rising around it can tell whether it still shows.
 * `blocked` cells (rivers) stay free.
 */
export function ridgeProps(grid: CoverGrid, size: number, seed: number, blocked: ReadonlySet<number> = new Set()): PropInstance[] {
  const { cols, rows } = grid;
  const index = (c: number, r: number) => (c < 0 || r < 0 || c >= cols || r >= rows ? -1 : r * cols + c);
  const isHigh = (i: number) => i >= 0 && grid.elevation[i] >= RIDGE_FROM;
  const mountain = (i: number) => isHigh(i) && grid.cells[i].water <= 1 && !blocked.has(i);
  const neighbours = (i: number) => offsetNeighbours(Math.floor(i / cols)).map((d) => index((i % cols) + d.dc, Math.floor(i / cols) + d.dr));
  const centre = (i: number) => offsetToPixel(i % cols, Math.floor(i / cols), size);
  const e = (...cells: number[]) => Math.min(...cells.map((i) => grid.elevation[i]));

  const props: PropInstance[] = [];
  const place = (elevation: number, p: Pixel, owner: number, a: number, b: number) => {
    const jx = (hash2(a, b, seed) - 0.5) * 2 * JITTER * size;
    const jy = (hash2(b, a, seed) - 0.5) * 2 * JITTER * size;
    const variant = Math.floor(hash2(a, b, seed + 1) * 1000);
    props.push({ kind: kindFor(elevation), variant, x: p.x + jx, y: p.y + jy, col: owner % cols, row: Math.floor(owner / cols), elevation });
  };
  for (let i = 0; i < cols * rows; i++) {
    if (!mountain(i)) continue;
    const p = centre(i);
    const around = neighbours(i);
    place(e(i), p, i, i, i);
    for (const j of around) {
      const q = j >= 0 ? centre(j) : p;
      if (j > i && mountain(j)) place(e(i, j), { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, i, i, j); // each link once
    }
    for (const j of around) {
      for (const k of around) {
        if (!(i < j && j < k && mountain(j) && mountain(k) && neighbours(j).includes(k))) continue; // each triangle once
        const [q, r] = [centre(j), centre(k)];
        place(e(i, j, k), { x: (p.x + q.x + r.x) / 3, y: (p.y + q.y + r.y) / 3 }, i, j, k);
      }
    }
  }
  return props;
}
