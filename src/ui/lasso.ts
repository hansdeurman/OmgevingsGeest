/**
 * An area drawn by hand: a stroke around some hexes. Where the stroke last
 * crosses itself, the loop it closed there is the area (a tail drawn on
 * past it is left off); if it never crosses itself, its two ends are joined
 * by a straight line. The hexes whose middles lie inside are the ones
 * chosen.
 */
export interface Vec {
  x: number;
  y: number;
}

/** Where segments a–b and c–d cross, as shares of the way along each, if they do. */
export function crossing(a: Vec, b: Vec, c: Vec, d: Vec): { t: number; u: number } | undefined {
  const [rx, ry, sx, sy] = [b.x - a.x, b.y - a.y, d.x - c.x, d.y - c.y];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return undefined;
  const [qx, qy] = [c.x - a.x, c.y - a.y];
  const [t, u] = [(qx * sy - qy * sx) / den, (qx * ry - qy * rx) / den];
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : undefined;
}

/** The outline of the area a stroke closes: the loop at its last crossing, or the whole stroke, its ends joined. */
export function closeLasso(stroke: readonly Vec[]): Vec[] {
  for (let j = stroke.length - 2; j >= 2; j--) {
    let last: { i: number; t: number } | undefined;
    for (let i = 0; i <= j - 2; i++) {
      const x = crossing(stroke[j], stroke[j + 1], stroke[i], stroke[i + 1]);
      if (x && (!last || x.t > last.t)) last = { i, t: x.t };
    }
    if (!last) continue;
    const [a, b] = [stroke[j], stroke[j + 1]];
    return [{ x: a.x + (b.x - a.x) * last.t, y: a.y + (b.y - a.y) * last.t }, ...stroke.slice(last.i + 1, j + 1)];
  }
  return [...stroke];
}

/** Whether `p` lies inside the outline (its last point joined to its first). */
export function inside(outline: readonly Vec[], p: Vec): boolean {
  let yes = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [a, b] = [outline[i], outline[j]];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) yes = !yes;
  }
  return yes;
}

/** The hexes (of `n`, their middles at `centre`) inside the outline. */
export function cellsIn(outline: readonly Vec[], n: number, centre: (i: number) => Vec): number[] {
  if (outline.length < 3) return [];
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const cells: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = centre(i);
    if (c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1 && inside(outline, c)) cells.push(i);
  }
  return cells;
}
