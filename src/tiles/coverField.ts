import { offsetNeighbours, offsetToPixel, pixelToOffset } from '../math/hex';
import { coverAt, inGrid, type CoverGrid } from './coverGrid';
import { LAYERS, levelAmount, zeroAmounts, type Amounts } from './levels';

/** Continuous view of a cover grid, in grid-local pixels (hex (0,0) at origin). */
export interface CoverField {
  sample(x: number, y: number, out?: Amounts): Amounts;
  inside(x: number, y: number): boolean;
}

/**
 * Gaussian-weighted blend of the containing hex and its six neighbours.
 * `blend` is the kernel width in hex radii: each hex stays pure near its
 * centre and meets its neighbour 50/50 exactly on the shared edge.
 */
export function createCoverField(grid: CoverGrid, size: number, blend: number): CoverField {
  const invSigma2 = 1 / (blend * size) ** 2;

  function sample(x: number, y: number, out: Amounts = zeroAmounts()): Amounts {
    for (const l of LAYERS) out[l] = 0;
    const { col, row } = pixelToOffset(x, y, size);
    let total = 0;
    const visit = (c: number, r: number) => {
      const cover = coverAt(grid, c, r);
      if (!cover) return;
      const p = offsetToPixel(c, r, size);
      const w = Math.exp(-((x - p.x) ** 2 + (y - p.y) ** 2) * invSigma2);
      total += w;
      for (const l of LAYERS) out[l] += w * levelAmount(cover[l]);
    };
    visit(col, row);
    for (const d of offsetNeighbours(row)) visit(col + d.dc, row + d.dr);
    if (total > 0) for (const l of LAYERS) out[l] /= total;
    return out;
  }

  function inside(x: number, y: number): boolean {
    const { col, row } = pixelToOffset(x, y, size);
    return inGrid(grid, col, row);
  }

  return { sample, inside };
}
