/**
 * Hex grid math. Pointy-top orientation with "odd-r" offset coordinates.
 *
 * Offset coords (col, row) are easy to iterate; axial (q, r) are easy to do
 * neighbour math with. We provide both and convert as needed.
 */

export interface Axial {
  q: number;
  r: number;
}

export interface Offset {
  col: number;
  row: number;
}

export interface Pixel {
  x: number;
  y: number;
}

const SQRT3 = Math.sqrt(3);

export function offsetToPixel(col: number, row: number, size: number): Pixel {
  const x = size * SQRT3 * (col + (row & 1) * 0.5);
  const y = size * 1.5 * row;
  return { x, y };
}

export function offsetToAxial(col: number, row: number): Axial {
  const q = col - ((row - (row & 1)) >> 1);
  return { q, r: row };
}

export function hexCorners(cx: number, cy: number, size: number): Pixel[] {
  const out: Pixel[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    out.push({ x: cx + size * Math.cos(angle), y: cy + size * Math.sin(angle) });
  }
  return out;
}

/** Bounding pixel size of an offset grid. */
export function gridPixelBounds(width: number, height: number, size: number): Pixel {
  const w = SQRT3 * size * (width + 0.5);
  const h = 1.5 * size * (height - 1) + 2 * size;
  return { x: w, y: h };
}

/** Six axial neighbours. */
export const AXIAL_NEIGHBOURS: ReadonlyArray<Axial> = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

/**
 * Six neighbour deltas in offset coords. Order is fixed (E, NE, NW, W, SW, SE)
 * and matches NEIGHBOUR_DIRS index-for-index, so simulations can iterate one
 * loop and use both the (col,row) delta and the geometric direction together.
 *
 * Odd-r layout: odd rows are shifted half a hex to the right, so their
 * diagonal neighbour columns differ by +1 instead of -1.
 */
export interface OffsetDelta { dc: number; dr: number; }

export const OFFSET_NEIGHBOURS_EVEN: ReadonlyArray<OffsetDelta> = [
  { dc:  1, dr:  0 }, // E
  { dc:  0, dr: -1 }, // NE
  { dc: -1, dr: -1 }, // NW
  { dc: -1, dr:  0 }, // W
  { dc: -1, dr:  1 }, // SW
  { dc:  0, dr:  1 }, // SE
];

export const OFFSET_NEIGHBOURS_ODD: ReadonlyArray<OffsetDelta> = [
  { dc:  1, dr:  0 }, // E
  { dc:  1, dr: -1 }, // NE
  { dc:  0, dr: -1 }, // NW
  { dc: -1, dr:  0 }, // W
  { dc:  0, dr:  1 }, // SW
  { dc:  1, dr:  1 }, // SE
];

export function offsetNeighbours(row: number): ReadonlyArray<OffsetDelta> {
  return (row & 1) === 0 ? OFFSET_NEIGHBOURS_EVEN : OFFSET_NEIGHBOURS_ODD;
}

const SQRT3_2 = Math.sqrt(3) / 2;

/**
 * Unit vectors from a hex centre to each of the six neighbours, in pixel
 * coords (y down, matching canvas). Index matches OFFSET_NEIGHBOURS_*:
 * [E, NE, NW, W, SW, SE]. Independent of row parity.
 */
export const NEIGHBOUR_DIRS: ReadonlyArray<Pixel> = [
  { x:  1.0, y:  0.0 },
  { x:  0.5, y: -SQRT3_2 },
  { x: -0.5, y: -SQRT3_2 },
  { x: -1.0, y:  0.0 },
  { x: -0.5, y:  SQRT3_2 },
  { x:  0.5, y:  SQRT3_2 },
];
