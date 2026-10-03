import { OFFSET_NEIGHBOURS_EVEN, OFFSET_NEIGHBOURS_ODD, offsetToPixel, pixelToOffset } from '../math/hex';
import { inGrid, type CoverGrid } from './coverGrid';
import { MAX_ELEVATION, levelAmount, zeroAmounts, type Amounts } from './levels';

/** Continuous view of a cover grid, in grid-local pixels (hex (0,0) at origin). */
export interface CoverField {
  sample(x: number, y: number, out?: Amounts): Amounts;
  inside(x: number, y: number): boolean;
}

const SQRT3 = Math.sqrt(3);
/** Column and row steps to a hex's six neighbours, for even rows then odd rows (offsetNeighbours order). */
const STEP_COL = Int8Array.from([...OFFSET_NEIGHBOURS_EVEN, ...OFFSET_NEIGHBOURS_ODD], (d) => d.dc);
const STEP_ROW = Int8Array.from([...OFFSET_NEIGHBOURS_EVEN, ...OFFSET_NEIGHBOURS_ODD], (d) => d.dr);

/**
 * Gaussian-weighted blend of the containing hex and its six neighbours.
 * `blend` is the kernel width in hex radii: each hex stays pure near its
 * centre and meets its neighbour 50/50 exactly on the shared edge.
 *
 * It is sampled for every pixel of the map, so each hex's amounts and
 * centre are worked out once and a sample allocates nothing.
 */
export function createCoverField(grid: CoverGrid, size: number, blend: number): CoverField {
  const invSigma2 = 1 / (blend * size) ** 2;
  const { cols, rows } = grid;
  // Per hex: water, grass, trees amounts and elevation; its centre.
  const amounts = new Float64Array(cols * rows * 4);
  const centres = new Float64Array(cols * rows * 2);
  grid.cells.forEach((cover, i) => {
    amounts.set([levelAmount(cover.water), levelAmount(cover.grass), levelAmount(cover.trees), grid.elevation[i]], i * 4);
    const p = offsetToPixel(i % cols, Math.floor(i / cols), size);
    centres.set([p.x, p.y], i * 2);
  });

  function sample(x: number, y: number, out: Amounts = zeroAmounts()): Amounts {
    // The hex the point lies in (cube rounding, as pixelToOffset), in plain numbers: this runs per pixel.
    const qf = ((SQRT3 / 3) * x - y / 3) / size;
    const rf = ((2 / 3) * y) / size;
    const sf = -qf - rf;
    let q = Math.round(qf);
    let r = Math.round(rf);
    const s = Math.round(sf);
    const qd = Math.abs(q - qf);
    const rd = Math.abs(r - rf);
    const sd = Math.abs(s - sf);
    if (qd > rd && qd > sd) q = -r - s;
    else if (rd > sd) r = -q - s;
    const row = r;
    const col = q + ((r - (r & 1)) >> 1);

    let water = 0;
    let grass = 0;
    let trees = 0;
    let alt = 0;
    let total = 0;
    const parity = (row & 1) * 6;
    for (let k = -1; k < 6; k++) {
      const c = k < 0 ? col : col + STEP_COL[parity + k];
      const rr = k < 0 ? row : row + STEP_ROW[parity + k];
      if (c < 0 || rr < 0 || c >= cols || rr >= rows) continue;
      const i = rr * cols + c;
      const dx = x - centres[2 * i];
      const dy = y - centres[2 * i + 1];
      const w = Math.exp(-(dx * dx + dy * dy) * invSigma2);
      total += w;
      water += w * amounts[4 * i];
      grass += w * amounts[4 * i + 1];
      trees += w * amounts[4 * i + 2];
      alt += (w * amounts[4 * i + 3]) / MAX_ELEVATION;
    }
    if (total > 0) {
      water /= total;
      grass /= total;
      trees /= total;
      alt /= total;
    }
    out.water = water;
    out.grass = grass;
    out.trees = trees;
    out.alt = alt;
    return out;
  }

  function inside(x: number, y: number): boolean {
    const { col, row } = pixelToOffset(x, y, size);
    return inGrid(grid, col, row);
  }

  return { sample, inside };
}
