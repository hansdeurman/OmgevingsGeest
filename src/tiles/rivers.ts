import type { Pixel } from '../math/hex';
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
      return { cells: path, cascades };
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
 * share `t` of the way along the river, so it can widen downstream.
 */
export function riverStroke(points: readonly Pixel[], W: number, H: number, width: (t: number) => number): Map<number, number> {
  const wet = new Map<number, number>();
  const lengths = points.slice(1).map((p, k) => Math.hypot(p.x - points[k].x, p.y - points[k].y));
  const total = lengths.reduce((s, l) => s + l, 0) || 1;
  let done = 0;
  lengths.forEach((len, k) => {
    const [a, b] = [points[k], points[k + 1]];
    const steps = Math.max(1, Math.ceil(len * 2));
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const [cx, cy] = [a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f];
      const r = width((done + len * f) / total) / 2;
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.floor(cy + r)); y++) {
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.floor(cx + r)); x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          if (d <= r) wet.set(y * W + x, Math.max(wet.get(y * W + x) ?? 0, 1 - d / r));
        }
      }
    }
    done += len;
  });
  return wet;
}
