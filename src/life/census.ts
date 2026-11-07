import { BESTIARY } from './bestiary';
import { hexAt, ROW } from './hexSpace';

/** Kinds of creature there are. */
export const KINDS = BESTIARY.length;

/**
 * Who is where, taken afresh each step: per hex how many creatures stand
 * on it and which, so a creature finds those near it (its prey, hunters,
 * its own kind) without looking at all of them.
 */
export interface Census {
  cols: number;
  rows: number;
  crowd: Float32Array;
  /** How many of each kind stand on each hex: `kinds[i * KINDS + kind]`. */
  kinds: Float32Array;
  /** First creature on each hex, and the next on the same hex after each (-1: none). */
  first: Int32Array;
  next: Int32Array;
}

interface Placed {
  x: number;
  y: number;
  kind?: number;
}

export const createCensus = (cols: number, rows: number): Census => ({
  cols,
  rows,
  crowd: new Float32Array(cols * rows),
  kinds: new Float32Array(cols * rows * KINDS),
  first: new Int32Array(cols * rows),
  next: new Int32Array(0),
});

export function takeCensus(c: Census, creatures: readonly Placed[]): void {
  c.crowd.fill(0);
  c.kinds.fill(0);
  c.first.fill(-1);
  if (c.next.length < creatures.length) c.next = new Int32Array(2 * creatures.length);
  creatures.forEach(({ x, y, kind = 0 }, k) => {
    const i = hexAt(c.cols, c.rows, x, y);
    c.crowd[i]++;
    c.kinds[i * KINDS + kind]++;
    c.next[k] = c.first[i];
    c.first[i] = k;
  });
}

/** How many creatures stand on hex `i`, or of one kind. */
export const countIn = (c: Census, i: number, kind?: number) => (kind === undefined ? c.crowd[i] : c.kinds[i * KINDS + kind]);

/** Whether hex `i` holds any of `kinds` (any creature at all, if not given). */
const holds = (c: Census, i: number, kinds?: readonly number[]) => {
  if (!kinds) return c.crowd[i] > 0;
  for (const k of kinds) if (c.kinds[i * KINDS + k] > 0) return true;
  return false;
};

/** The hexes within `reach` of (x, y) (and a little beyond) that hold any of `kinds`. */
function visitHexes(c: Census, x: number, y: number, reach: number, visit: (i: number) => void, kinds?: readonly number[]): void {
  const [r0, r1] = [Math.max(0, Math.floor((y - reach) / ROW)), Math.min(c.rows - 1, Math.ceil((y + reach) / ROW))];
  const [c0, c1] = [Math.max(0, Math.floor(x - reach - 0.5)), Math.min(c.cols - 1, Math.ceil(x + reach))];
  for (let row = r0; row <= r1; row++)
    for (let col = c0; col <= c1; col++) if (holds(c, row * c.cols + col, kinds)) visit(row * c.cols + col);
}

/** Visit every creature (by index) within `reach` of (x, y), with how far it is; only on hexes holding any of `kinds`, if given. */
function visitNear<T extends Placed>(c: Census, creatures: readonly T[], x: number, y: number, reach: number, visit: (k: number, d: number) => void, kinds?: readonly number[]): void {
  visitHexes(
    c,
    x,
    y,
    reach,
    (i) => {
      for (let k = c.first[i]; k >= 0; k = c.next[k]) {
        const d = Math.hypot(creatures[k].x - x, creatures[k].y - y);
        if (d <= reach) visit(k, d);
      }
    },
    kinds,
  );
}

/** The nearest creature (by index) within `reach` of (x, y) that passes `keep` and is of one of `kinds` (if given), or -1. */
export function closest<T extends Placed>(c: Census, creatures: readonly T[], x: number, y: number, reach: number, keep: (k: number) => boolean, kinds?: readonly number[]): number {
  let [best, far] = [-1, Infinity];
  visitNear(
    c,
    creatures,
    x,
    y,
    reach,
    (k, d) => {
      if ((d < far || (d === far && k < best)) && (!kinds || kinds.includes(creatures[k].kind ?? 0)) && keep(k)) [best, far] = [k, d];
    },
    kinds,
  );
  return best;
}

/** Where the creatures of `kind` within about `reach` of (x, y) are on average, by hex, and how many: (x, y) itself, alone. */
export function middleOf(c: Census, x: number, y: number, reach: number, kind: number): { x: number; y: number; count: number } {
  const m = { x: 0, y: 0, count: 0 };
  visitHexes(
    c,
    x,
    y,
    reach,
    (i) => {
      const n = c.kinds[i * KINDS + kind];
      const row = Math.floor(i / c.cols);
      [m.x, m.y, m.count] = [m.x + n * (i - row * c.cols + (row & 1) / 2), m.y + n * row * ROW, m.count + n];
    },
    [kind],
  );
  return m.count ? { x: m.x / m.count, y: m.y / m.count, count: m.count } : { x, y, count: 0 };
}

/** How many creatures within `reach` of (x, y) pass `keep`. */
export function countNear<T extends Placed>(c: Census, creatures: readonly T[], x: number, y: number, reach: number, keep: (k: number) => boolean = () => true): number {
  let count = 0;
  visitNear(c, creatures, x, y, reach, (k) => keep(k) && count++);
  return count;
}

/** The creatures (by index) within `reach` of (x, y) that pass `keep`, nearest first. */
export function nearby<T extends Placed>(c: Census, creatures: readonly T[], x: number, y: number, reach: number, keep: (k: number) => boolean = () => true): number[] {
  const found: [number, number][] = [];
  visitNear(c, creatures, x, y, reach, (k, d) => keep(k) && found.push([d, k]));
  return found.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, k]) => k);
}
