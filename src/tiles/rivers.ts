import type { Pixel } from '../math/hex';
import { valueNoise2D } from '../math/noise';
import { smoothstep } from '../math/scalar';
import { fillDepressions, lakeOutlets, neighbourIndices, type ElevationMap } from './hydrology';

/**
 * Rivers: where the water of a high lake goes. Each lake overflows at its
 * outlet and the river follows the terrain down to the sea, so a flood is
 * predictable: it always takes this route.
 */
export interface River {
  /** Cells from a lake cell through the outlet down to the sea (or the map edge, or the next lake). */
  cells: number[];
  /** Consecutive cell pairs where the river drops steeply: drawn as a cascade. */
  cascades: [number, number][];
  /** Where the lake overflows: from the edge of its basin into the lower cell. */
  outlet: [number, number];
}

/** Elevation drop (steps) between neighbouring river cells that shows as a cascade below the outlet. */
export const CASCADE_DROP = 1.5;
/** The drop over a lake's outlet that already shows as a cascade: where the lake visibly pours out. */
const OUTLET_DROP = 0.5;

const isEdge = (map: ElevationMap, i: number) => {
  const col = i % map.cols;
  const row = Math.floor(i / map.cols);
  return col === 0 || row === 0 || col === map.cols - 1 || row === map.rows - 1;
};

/**
 * Follow the terrain down from `start`: always to the unvisited neighbour
 * with the lowest filled water level (so the river crosses depressions
 * instead of getting stuck), lowest ground first on ties.
 */
function downhill(map: ElevationMap, start: number, stop: (i: number) => boolean, level: readonly number[]): number[] {
  const path = [start];
  const seen = new Set(path);
  for (let i = start; !stop(i) && !isEdge(map, i) && path.length <= map.cols * map.rows; ) {
    const next = neighbourIndices(map, i)
      .filter((j) => !seen.has(j))
      .sort((a, b) => level[a] - level[b] || map.elevation[a] - map.elevation[b])[0];
    if (next === undefined) break;
    path.push(next);
    seen.add(next);
    i = next;
  }
  return path;
}

export function lakeRivers(map: ElevationMap, isLake: (i: number) => boolean, isSea: (i: number) => boolean, cascadeDrop = CASCADE_DROP): River[] {
  const level = fillDepressions(map);
  return lakeOutlets(map, isLake)
    .filter(({ from, to }) => from >= 0 && to >= 0)
    .map(({ cells, from, to }) => {
      // Start in the lake: on the lake cell next to where the water leaves its basin.
      const source = isLake(from) ? from : (neighbourIndices(map, from).find(isLake) ?? cells[0]);
      const head = source === from ? [from] : [source, from];
      const path = [...head, ...downhill(map, to, (i) => isSea(i) || isLake(i), level)];
      const cascades = path
        .slice(1)
        .map((b, k): [number, number] => [path[k], b])
        .filter(([a, b], k) => map.elevation[a] - map.elevation[b] >= (k === head.length - 1 ? OUTLET_DROP : cascadeDrop));
      return { cells: path, cascades, outlet: [from, to] as [number, number] };
    });
}

/** Chaikin corner cutting: a smooth curve through a polyline, keeping its ends. */
export function smoothPath(points: readonly Pixel[], iterations: number): Pixel[] {
  let pts = [...points];
  for (let n = 0; n < iterations && pts.length > 2; n++) {
    const next: Pixel[] = [pts[0]];
    for (let k = 0; k < pts.length - 1; k++) {
      const [a, b] = [pts[k], pts[k + 1]];
      if (k > 0) next.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y });
      if (k < pts.length - 2) next.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

/**
 * The pixels a river along `points` covers, each with how close it lies to
 * the centre line (1 on it, 0 at the bank). `width(t)` is the width in px at
 * share `t` of the way along the river, so it can widen downstream. The
 * points are frame pixels; the pixels are of a W x H raster `squash`ed
 * vertically (the projected map), where the river is as much flatter.
 */
export function riverStroke(points: readonly Pixel[], W: number, H: number, width: (t: number) => number, squash = 1): Map<number, number> {
  const wet = new Map<number, number>();
  const lengths = points.slice(1).map((p, k) => Math.hypot(p.x - points[k].x, p.y - points[k].y));
  const total = lengths.reduce((s, l) => s + l, 0) || 1;
  let done = 0;
  lengths.forEach((len, k) => {
    // Every pixel near this stretch, by its distance to it; the width runs on evenly along it.
    const [a, b] = [points[k], points[k + 1]];
    const [r0, r1] = [width(done / total) / 2, width((done + len) / total) / 2];
    done += len;
    const reach = Math.max(r0, r1);
    if (reach <= 0) return;
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    const len2 = dx * dx + dy * dy || 1;
    const [y0, y1] = [Math.max(0, Math.floor((Math.min(a.y, b.y) - reach) * squash)), Math.min(H - 1, Math.floor((Math.max(a.y, b.y) + reach) * squash))];
    const [x0, x1] = [Math.max(0, Math.floor(Math.min(a.x, b.x) - reach)), Math.min(W - 1, Math.floor(Math.max(a.x, b.x) + reach))];
    for (let y = y0; y <= y1; y++) {
      const py = (y + 0.5) / squash;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const u = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
        const d = Math.hypot(px - a.x - u * dx, py - a.y - u * dy);
        const r = r0 + (r1 - r0) * u;
        if (d > r) continue;
        const i = y * W + x;
        const close = 1 - d / r;
        if (close > (wet.get(i) ?? 0)) wet.set(i, close);
      }
    }
  });
  return wet;
}

/**
 * White water around a cascade at `at`, in [0, 1]: broken foam streaks,
 * strongest at the drop and fading out over `radius` px. Painted into the
 * river itself, so a steep stretch reads as rapids rather than a pasted sprite.
 */
export function rapidsFoam(x: number, y: number, at: Pixel, radius: number): number {
  const d = Math.hypot(x - at.x, y - at.y);
  if (d >= radius) return 0;
  const streaks = smoothstep(0.35, 0.7, valueNoise2D(x * 0.45, y * 0.2, 77));
  return smoothstep(radius, radius * 0.3, d) * (0.35 + 0.65 * streaks);
}
