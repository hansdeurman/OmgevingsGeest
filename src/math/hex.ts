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
