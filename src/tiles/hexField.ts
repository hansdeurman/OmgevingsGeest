import { offsetNeighbours, pixelToOffset } from '../math/hex';
import { frameCentre, type GridFrame } from './geometry';

/**
 * A value per hex as a smooth field over the frame: on a coarse grid of
 * points each point blends the hex it lies in and its neighbours (Gaussian
 * by distance), and between the points the field runs on linearly. Which
 * hexes a point blends, and how much, is worked out once per map; turning
 * new values into a field is then a few sums per point.
 */
export interface HexBlend {
  /** Pixels between grid points, and the grid's size. */
  step: number;
  gw: number;
  gh: number;
  /** Per point, `NEAR` hexes (-1: none) and their weights, summing to 1. */
  cells: Int32Array;
  weights: Float32Array;
}

/** The hex a point lies in and its six neighbours. */
const NEAR = 7;

export function hexBlend(cols: number, rows: number, frame: GridFrame, size: number, blend = 0.7, step = 8): HexBlend {
  const [gw, gh] = [Math.ceil(frame.width / step) + 1, Math.ceil(frame.height / step) + 1];
  const cells = new Int32Array(gw * gh * NEAR).fill(-1);
  const weights = new Float32Array(gw * gh * NEAR);
  const invSigma2 = 1 / (blend * size) ** 2;
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const [x, y] = [gx * step, gy * step];
      const { col, row } = pixelToOffset(x - frame.ox, y - frame.oy, size);
      const near = [{ dc: 0, dr: 0 }, ...offsetNeighbours(row)]
        .map(({ dc, dr }) => [col + dc, row + dr])
        .filter(([c, r]) => c >= 0 && r >= 0 && c < cols && r < rows);
      const w = near.map(([c, r]) => {
        const p = frameCentre(c, r, size, frame);
        return Math.exp(-((x - p.x) ** 2 + (y - p.y) ** 2) * invSigma2);
      });
      const total = w.reduce((s, v) => s + v, 0) || 1;
      const k = (gy * gw + gx) * NEAR;
      near.forEach(([c, r], n) => {
        cells[k + n] = r * cols + c;
        weights[k + n] = w[n] / total;
      });
    }
  }
  return { step, gw, gh, cells, weights };
}

/** The field of `values` (per hex) at the grid points, into `out` if given. */
export function blendField(b: HexBlend, values: ArrayLike<number>, out = new Float32Array(b.gw * b.gh)): Float32Array {
  for (let p = 0; p < out.length; p++) {
    let v = 0;
    for (let k = p * NEAR; k < (p + 1) * NEAR; k++) if (b.cells[k] >= 0) v += b.weights[k] * values[b.cells[k]];
    out[p] = v;
  }
  return out;
}

/** The field at frame pixel (x, y), between the four grid points around it. */
export function sampleField(b: HexBlend, field: Float32Array, x: number, y: number): number {
  // Plain numbers only: this runs per pixel.
  const fx = Math.min(b.gw - 1.001, Math.max(0, x / b.step));
  const fy = Math.min(b.gh - 1.001, Math.max(0, y / b.step));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const u = fx - x0;
  const v = fy - y0;
  const k = y0 * b.gw + x0;
  const top = field[k] + (field[k + 1] - field[k]) * u;
  const bottom = field[k + b.gw] + (field[k + b.gw + 1] - field[k + b.gw]) * u;
  return top + (bottom - top) * v;
}
