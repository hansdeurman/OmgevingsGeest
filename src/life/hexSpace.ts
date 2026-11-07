import { hexTopology, pipeTarget } from '../water/hexTopology';

/**
 * Where creatures are on the map: anywhere, not only on hex centres, in hex
 * spacings (x east, y south) from the centre of hex (0, 0), in the map's
 * odd-r layout: odd rows half a spacing to the east.
 */

/** Rows lie this far apart. */
export const ROW = Math.sqrt(3) / 2;

export const centreOf = (cols: number, i: number) => {
  const row = Math.floor(i / cols);
  return { x: i - row * cols + (row & 1) / 2, y: row * ROW };
};

const clampInt = (v: number, hi: number) => Math.max(0, Math.min(hi, v));

/** The hex whose centre is nearest (x, y): the one it lies in, or the nearest at the map's edge. */
export function hexAt(cols: number, rows: number, x: number, y: number): number {
  const r0 = clampInt(Math.floor(y / ROW), rows - 1);
  let [best, far] = [0, Infinity];
  for (const row of [r0, clampInt(r0 + 1, rows - 1)]) {
    const col = clampInt(Math.round(x - (row & 1) / 2), cols - 1);
    const d = (x - col - (row & 1) / 2) ** 2 + (y - row * ROW) ** 2;
    if (d < far) [best, far] = [row * cols + col, d];
  }
  return best;
}

/** Whether (x, y) lies on the map: between its outermost hex centres. */
export const inside = (cols: number, rows: number, x: number, y: number) => x >= 0 && x <= cols - 0.5 && y >= 0 && y <= (rows - 1) * ROW;

const rings = new Map<string, Int32Array>();

/** The six neighbours of every hex (`ring[6 * i + d]`, -1 off the map), worked out once per map size. */
export function ring(cols: number, rows: number): Int32Array {
  const key = `${cols}×${rows}`;
  let r = rings.get(key);
  if (!r) {
    const t = hexTopology(cols, rows, 6);
    r = Int32Array.from({ length: 6 * t.n }, (_, k) => pipeTarget(t, Math.floor(k / 6), k % 6));
    rings.set(key, r);
  }
  return r;
}
