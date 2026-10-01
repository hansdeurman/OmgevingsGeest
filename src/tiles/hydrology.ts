import { offsetNeighbours } from '../math/hex';

/** Minimal elevation map: row-major, odd-r offset layout. */
export interface ElevationMap {
  cols: number;
  rows: number;
  elevation: readonly number[];
}

function neighbourIndices(map: ElevationMap, i: number): number[] {
  const col = i % map.cols;
  const row = Math.floor(i / map.cols);
  const out: number[] = [];
  for (const d of offsetNeighbours(row)) {
    const c = col + d.dc;
    const r = row + d.dr;
    if (c >= 0 && r >= 0 && c < map.cols && r < map.rows) out.push(r * map.cols + c);
  }
  return out;
}

/** Tiny binary min-heap of [priority, index] pairs. */
class MinQueue {
  private items: [number, number][] = [];
  get size(): number {
    return this.items.length;
  }
  push(item: [number, number]): void {
    const a = this.items;
    a.push(item);
    for (let i = a.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Priority-flood: the water level every cell would hold if rain filled each
 * basin until it overflows. Water drains off the map edge, so edge cells keep
 * their own height; a cell whose level ends up above its elevation is a lake.
 */
export function fillDepressions(map: ElevationMap): number[] {
  const n = map.cols * map.rows;
  const level = new Array<number>(n);
  const done = new Uint8Array(n);
  const queue = new MinQueue();
  for (let i = 0; i < n; i++) {
    const col = i % map.cols;
    const row = Math.floor(i / map.cols);
    if (col === 0 || row === 0 || col === map.cols - 1 || row === map.rows - 1) {
      level[i] = map.elevation[i];
      done[i] = 1;
      queue.push([level[i], i]);
    }
  }
  while (queue.size) {
    const [l, i] = queue.pop();
    for (const j of neighbourIndices(map, i)) {
      if (done[j]) continue;
      done[j] = 1;
      level[j] = Math.max(map.elevation[j], l);
      queue.push([level[j], j]);
    }
  }
  return level;
}

/**
 * Where the lake containing `lakeCell` overflows: the lowest cell bordering
 * the lake. Raising the lake, or lowering this cell, decides where a flood goes.
 */
export function spillPoint(map: ElevationMap, level: readonly number[], lakeCell: number): { index: number; level: number } {
  const surface = level[lakeCell];
  const isLake = (i: number) => level[i] === surface && level[i] > map.elevation[i];
  const seen = new Set([lakeCell]);
  const stack = [lakeCell];
  let best = { index: -1, level: Infinity };
  while (stack.length) {
    const i = stack.pop()!;
    for (const j of neighbourIndices(map, i)) {
      if (seen.has(j)) continue;
      seen.add(j);
      if (isLake(j)) stack.push(j);
      else if (map.elevation[j] < best.level) best = { index: j, level: map.elevation[j] };
    }
  }
  return best;
}

/**
 * A lake (connected lake cells) and where it pours out: from a cell of its
 * basin into the lowest cell around it. The basin is the lake plus the land
 * lying at its surface level (its shore), since water spreads over that first.
 */
export interface LakeOutlet {
  cells: number[];
  from: number;
  to: number;
}

const LEVEL_EPS = 1e-6;

/** Connected cells from `start` that pass `inside`, plus the lowest outside neighbour as the way out. */
function floodRegion(map: ElevationMap, start: number, inside: (i: number) => boolean, seen: Set<number>) {
  const cells: number[] = [];
  const stack = [start];
  seen.add(start);
  let best = { from: -1, to: -1, level: Infinity };
  while (stack.length) {
    const i = stack.pop()!;
    cells.push(i);
    for (const j of neighbourIndices(map, i)) {
      if (seen.has(j)) continue;
      if (inside(j)) {
        seen.add(j);
        stack.push(j);
      } else if (map.elevation[j] < best.level) {
        best = { from: i, to: j, level: map.elevation[j] };
      }
    }
  }
  return { cells, from: best.from, to: best.to };
}

export function lakeOutlets(map: ElevationMap, isLake: (i: number) => boolean): LakeOutlet[] {
  const seen = new Set<number>();
  const out: LakeOutlet[] = [];
  for (let start = 0; start < map.cols * map.rows; start++) {
    if (seen.has(start) || !isLake(start)) continue;
    const { cells } = floodRegion(map, start, isLake, seen);
    const level = map.elevation[start];
    const atLevel = (i: number) => isLake(i) || Math.abs(map.elevation[i] - level) < LEVEL_EPS;
    const { from, to } = floodRegion(map, start, atLevel, new Set());
    out.push({ cells, from, to });
  }
  return out;
}
