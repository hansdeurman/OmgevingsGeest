import { EDGE_VECTORS, type HexTopology } from './hexTopology';

/**
 * Fields over the air of a hex map, and how they change with the wind:
 * their slope, how the wind spreads out or closes in, carrying a stuff
 * that is never lost (water: what one hex gives, another gets) and
 * carrying a temperature (a hex takes on the air the wind brings it), and
 * mixing neighbours. The sky has no edge: it wraps around, so what blows
 * off the map on one side comes back on the other (the map is a whole
 * world, closed, and no wall dams the wind). Per hex the six edge
 * neighbours; directions in hex spacings, x east, y south.
 */

const cache = new WeakMap<HexTopology, Int32Array>();

/** Per hex the hex across each of its six edges (index `hex * 6 + direction`), across the map's edge to the far side. */
export function neighbours(topo: HexTopology): Int32Array {
  let nb = cache.get(topo);
  if (!nb) {
    const { cols, rows, dirs, dc, dr } = topo;
    const wrap = (v: number, m: number) => ((v % m) + m) % m;
    nb = new Int32Array(topo.n * 6);
    for (let i = 0; i < topo.n; i++) {
      const [row, col] = [Math.floor(i / cols), i % cols];
      for (let d = 0; d < 6; d++) nb[i * 6 + d] = wrap(row + dr[d], rows) * cols + wrap(col + dc[(row & 1) * dirs + d], cols);
    }
    cache.set(topo, nb);
  }
  return nb;
}

const [EX, EY] = [Float32Array.from(EDGE_VECTORS, ([x]) => x), Float32Array.from(EDGE_VECTORS, ([, y]) => y)];
/** Of a hex's air, the share that crosses one edge per step for each hex spacing the wind blows across it: edge length over area. */
const EDGE_SHARE = 2 / 3;
/** At most this share of a hex's air leaves it per step, however strong the wind. */
const MOST_LEAVING = 0.9;

/** Slope of `f` per hex into (gx, gy): for the six unit edge vectors e, Σ (e·g) e = 3g. Level beyond the map's edge. */
export function gradient(topo: HexTopology, f: ArrayLike<number>, gx: Float32Array, gy: Float32Array): void {
  const nb = neighbours(topo);
  for (let i = 0; i < topo.n; i++) {
    let [x, y] = [0, 0];
    for (let d = 0; d < 6; d++) {
      const j = nb[i * 6 + d];
      const rise = j < 0 ? 0 : f[j] - f[i];
      x += rise * EX[d];
      y += rise * EY[d];
    }
    gx[i] = x / 3;
    gy[i] = y / 3;
  }
}

/** How much the wind (ux, uy) spreads out at each hex (closing in: below 0), into `out`. No wind beyond the map's edge. */
export function divergence(topo: HexTopology, ux: ArrayLike<number>, uy: ArrayLike<number>, out: Float32Array): void {
  const nb = neighbours(topo);
  for (let i = 0; i < topo.n; i++) {
    let s = 0;
    for (let d = 0; d < 6; d++) {
      const j = nb[i * 6 + d];
      const [x, y] = j < 0 ? [0, 0] : [ux[j], uy[j]];
      s += (x - ux[i]) * EX[d] + (y - uy[i]) * EY[d];
    }
    out[i] = s / 3;
  }
}

/** Share of hex i's air the wind (x, y) sends across each edge, in `shares` (six). */
function leaving(x: number, y: number, shares: Float32Array): void {
  let total = 0;
  for (let d = 0; d < 6; d++) total += shares[d] = EDGE_SHARE * Math.max(0, x * EX[d] + y * EY[d]);
  if (total > MOST_LEAVING) for (let d = 0; d < 6; d++) shares[d] *= MOST_LEAVING / total;
}

const shares = new Float32Array(6);
let scratch = new Float32Array(0);

/**
 * Carry `q` one step with the wind (ux, uy) per hex, in place, losing nothing:
 * each hex sends a share across every edge its wind blows through, held
 * back `block` per step of rise up to the next hex's `floor`; the map's
 * edges are closed.
 */
export function carry(topo: HexTopology, q: Float32Array, ux: ArrayLike<number>, uy: ArrayLike<number>, floor?: ArrayLike<number>, block = 0): void {
  const nb = neighbours(topo);
  if (scratch.length < topo.n) scratch = new Float32Array(topo.n);
  const next = scratch;
  next.fill(0, 0, topo.n);
  for (let i = 0; i < topo.n; i++) {
    leaving(ux[i], uy[i], shares);
    let left = q[i];
    for (let d = 0; d < 6; d++) {
      const j = nb[i * 6 + d];
      if (j < 0 || !shares[d]) continue;
      const moved = (shares[d] * q[i]) / (floor ? 1 + block * Math.max(0, floor[j] - floor[i]) : 1);
      next[j] += moved;
      left -= moved;
    }
    next[i] += left;
  }
  q.set(next.subarray(0, topo.n));
}

/** `t` (a temperature) a step later, into `out`: each hex takes on a share of the air its wind brings from upwind. Even beyond the map's edge. */
export function advect(topo: HexTopology, t: ArrayLike<number>, ux: ArrayLike<number>, uy: ArrayLike<number>, out: Float32Array): void {
  const nb = neighbours(topo);
  for (let i = 0; i < topo.n; i++) {
    leaving(-ux[i], -uy[i], shares); // the shares upwind
    let v = t[i];
    for (let d = 0; d < 6; d++) {
      const j = nb[i * 6 + d];
      if (j >= 0 && shares[d]) v += shares[d] * (t[j] - t[i]);
    }
    out[i] = v;
  }
}

/** Mix `t` with its neighbours, in place: `k` of the way to their mean per step. Keeps the total; `work` holds n numbers. */
export function mix(topo: HexTopology, t: Float32Array, k: number, work: Float32Array): void {
  const nb = neighbours(topo);
  work.fill(0, 0, topo.n);
  for (let i = 0; i < topo.n; i++) {
    for (let d = 0; d < 6; d++) {
      const j = nb[i * 6 + d];
      if (j > i) {
        const flow = (k / 6) * (t[j] - t[i]);
        work[i] += flow;
        work[j] -= flow;
      }
    }
  }
  for (let i = 0; i < topo.n; i++) t[i] += work[i];
}
