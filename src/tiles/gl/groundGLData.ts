import type { RiverLine } from '../riverPaint';

/** Floats per river vertex: x, y (frame px), how far across (-1 one bank … 1 the other), how white the water is. */
export const RIVER_VERTEX = 4;

/**
 * River lines as triangles for the GPU: per stretch between two points a
 * quad as wide as the bed (or the water) there, each corner knowing how far
 * across the river it lies, so the shader can soften the banks as painting
 * does. Stretches without width are left out.
 */
/** A stretch's two triangles: which end (0 this point, 1 the next) and which bank each corner is on. */
const QUAD: readonly [0 | 1, -1 | 1][] = [[0, -1], [0, 1], [1, -1], [1, -1], [0, 1], [1, 1]];

export function riverMesh(lines: readonly RiverLine[], part: 'bed' | 'water'): Float32Array {
  const out: number[] = [];
  for (const line of lines) {
    const { points, foam } = line;
    const width = line[part];
    const n = points.length;
    // Per point, the way across: perpendicular to the line through its neighbours.
    const side = points.map((_, k) => {
      const [a, b] = [points[Math.max(0, k - 1)], points[Math.min(n - 1, k + 1)]];
      const [dx, dy] = [b.x - a.x, b.y - a.y];
      const len = Math.hypot(dx, dy) || 1;
      return { x: -dy / len, y: dx / len };
    });
    const corner = (k: number, across: -1 | 1) => {
      const h = (width[k] / 2) * across;
      out.push(points[k].x + side[k].x * h, points[k].y + side[k].y * h, across, foam[k]);
    };
    for (let k = 0; k + 1 < n; k++) {
      if (width[k] <= 0 && width[k + 1] <= 0) continue;
      for (const [j, across] of QUAD) corner(k + j, across);
    }
  }
  return Float32Array.from(out);
}
