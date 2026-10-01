import type { Amounts, Cover, Layer } from './levels';

/** Upright sprites standing on the ground. Each kind has several variants. */
export const PROP_KINDS = ['tree', 'bush', 'tuft', 'flower', 'reed', 'pebble'] as const;
export type PropKind = (typeof PROP_KINDS)[number];

/**
 * How one prop kind is scattered over a hex. Gradations live here: the level
 * of a layer sets how many props a hex gets, so "first tree" vs "dense
 * forest" is a count, not a separate tile.
 */
export interface PropRule {
  kind: PropKind;
  /** Number of props to place on a hex with this cover. */
  count(cover: Cover): number;
  /** Bias placement toward where this layer is denser (e.g. the forest side). */
  prefer?: Layer;
  /** Minimum distance between props of this rule within a hex, in hex radii. */
  spacing: number;
  /** Whether the ground at a candidate spot can hold this prop. */
  fits(a: Amounts): boolean;
}

export const byLevel = (layer: Layer, counts: readonly number[]) => (c: Cover) => counts[c[layer]] ?? 0;

const dry = (a: Amounts) => a.water < 0.34;

export const PROP_RULES: readonly PropRule[] = [
  { kind: 'tree', count: byLevel('trees', [0, 1, 3, 6, 10]), prefer: 'trees', spacing: 0.3, fits: dry },
  { kind: 'bush', count: byLevel('trees', [0, 1, 2, 2, 1]), prefer: 'trees', spacing: 0.22, fits: dry },
  {
    kind: 'tuft',
    count: (c) => (c.trees >= 3 ? 0 : [0, 5, 4, 2, 0][c.grass]),
    prefer: 'grass',
    spacing: 0.16,
    fits: dry,
  },
  {
    kind: 'flower',
    count: (c) => (c.trees >= 3 ? 0 : [0, 0, 1, 3, 6][c.grass]),
    prefer: 'grass',
    spacing: 0.14,
    fits: (a) => dry(a) && a.grass > 0.45,
  },
  { kind: 'reed', count: byLevel('water', [0, 3, 3, 2, 0]), spacing: 0.1, fits: (a) => a.water > 0.3 && a.water < 0.48 },
  {
    kind: 'pebble',
    count: (c) => (c.grass + c.trees === 0 && c.water <= 1 ? 2 : 0),
    spacing: 0.3,
    fits: (a) => a.water < 0.3 && a.grass < 0.28,
  },
];
