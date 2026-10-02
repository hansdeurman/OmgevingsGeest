/**
 * The pipes water flows through on a hex map (odd-r offset layout): from
 * every hex six across its edges to its neighbours, and optionally six more
 * past its corners to the hex beyond, between the two neighbours beside that
 * corner. On a regular map every pipe can be worked out from a hex's row and
 * column, so the topology is a few small tables, whatever the map's size;
 * only the flow itself takes memory per pipe (index `hex * dirs + direction`).
 */
export interface HexTopology {
  cols: number;
  rows: number;
  n: number;
  dirs: 6 | 12;
  /** Column step per direction, for even rows then odd rows: `dc[(row & 1) * dirs + d]`. */
  dc: Int8Array;
  /** Row step per direction. */
  dr: Int8Array;
  /** Length of each direction's pipe, in hex spacings: 1 across an edge, √3 past a corner. */
  length: Float32Array;
}

/** Axial steps across the six edges; opposite directions are three apart. */
const EDGES: readonly [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
/** Past corner c, between edges c and c + 1: their sum. */
const CORNERS = EDGES.map(([q, r], c): [number, number] => [q + EDGES[(c + 1) % 6][0], r + EDGES[(c + 1) % 6][1]]);

/** The direction pointing back. */
export const opposite = (d: number) => (d < 6 ? (d + 3) % 6 : 6 + ((d - 3) % 6));

/** The two edge directions beside corner direction `d` (6–11). */
export const besideCorner = (d: number): [number, number] => [d - 6, (d - 5) % 6];

export function hexTopology(cols: number, rows: number, dirs: 6 | 12 = 12): HexTopology {
  const steps = dirs === 12 ? [...EDGES, ...CORNERS] : EDGES;
  const dc = new Int8Array(2 * dirs);
  const dr = Int8Array.from(steps, ([, r]) => r);
  for (const parity of [0, 1]) {
    const row = 10 + parity; // any row of this parity, far from the edge
    const toCol = (q: number, r: number) => q + ((r - (r & 1)) >> 1);
    const q = 10 - ((row - parity) >> 1);
    steps.forEach(([sq, sr], d) => (dc[parity * dirs + d] = toCol(q + sq, row + sr) - 10));
  }
  const length = Float32Array.from(steps, (_, d) => (d < 6 ? 1 : Math.sqrt(3)));
  return { cols, rows, n: cols * rows, dirs, dc, dr, length };
}

/** The hex the pipe from hex `i` in direction `d` leads to, or -1 off the map. */
export function pipeTarget(t: HexTopology, i: number, d: number): number {
  const row = Math.floor(i / t.cols);
  const col = i - row * t.cols + t.dc[(row & 1) * t.dirs + d];
  const r = row + t.dr[d];
  return r < 0 || r >= t.rows || col < 0 || col >= t.cols ? -1 : r * t.cols + col;
}
