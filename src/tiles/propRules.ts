import { ROCK_LINE } from './groundShader';
import type { Amounts, Cover, Layer } from './levels';

/** Upright sprites standing on the ground. Each kind has several variants. */
export const PROP_KINDS = [
  'tree',
  'bush',
  'tuft',
  'flower',
  'reed',
  'pebble',
  'boulder',
  'hill',
  'crag',
  'peak',
  'fall',
] as const;
export type PropKind = (typeof PROP_KINDS)[number];

/**
 * How one prop kind is scattered over a hex. Gradations live here: the level
 * of a layer sets how many props a hex gets, so "first tree" vs "dense
 * forest" is a count, not a separate tile.
 */
export interface PropRule {
  kind: PropKind;
  /** Number of props to place on a hex with this cover and elevation (terrace steps). */
  count(cover: Cover, elevation: number): number;
  /** Probability that the rule applies to a hex at all (default 1). */
  chance?: number;
  /** Place near the hex centre instead of anywhere (for big props like mountains). */
  centred?: boolean;
  /** Bias placement toward where this layer is denser (e.g. the forest side). */
  prefer?: Layer;
  /** Minimum distance between props of this rule within a hex, in hex radii. */
  spacing: number;
  /** Whether the ground at a candidate spot can hold this prop. */
  fits(a: Amounts): boolean;
}

export const byLevel = (layer: Layer, counts: readonly number[]) => (c: Cover) => counts[c[layer]] ?? 0;
export const byElevation = (counts: readonly number[]) => (_: Cover, e: number) => counts[Math.round(e)] ?? 0;

const dry = (a: Amounts) => a.water < 0.34;
/** Below the rock line: soil that can hold plants. */
const soil = (a: Amounts) => dry(a) && a.alt < ROCK_LINE[0] + 0.05;

export const PROP_RULES: readonly PropRule[] = [
  { kind: 'tree', count: byLevel('trees', [0, 1, 3, 6, 10]), prefer: 'trees', spacing: 0.3, fits: soil },
  { kind: 'bush', count: byLevel('trees', [0, 1, 2, 2, 1]), prefer: 'trees', spacing: 0.22, fits: soil },
  {
    kind: 'tuft',
    count: (c) => (c.trees >= 3 ? 0 : [0, 5, 4, 2, 0][c.grass]),
    prefer: 'grass',
    spacing: 0.16,
    fits: soil,
  },
  {
    kind: 'flower',
    count: (c) => (c.trees >= 3 ? 0 : [0, 0, 1, 3, 6][c.grass]),
    prefer: 'grass',
    spacing: 0.14,
    fits: (a) => soil(a) && a.grass > 0.45,
  },
  // Reeds belong to lowland water: around a mountain lake they would make it read as sea level.
  {
    kind: 'reed',
    count: byLevel('water', [0, 3, 3, 2, 0]),
    spacing: 0.1,
    fits: (a) => a.water > 0.3 && a.water < 0.48 && a.alt < ROCK_LINE[0],
  },
  {
    kind: 'pebble',
    count: (c) => (c.grass + c.trees === 0 && c.water <= 1 ? 2 : 0),
    spacing: 0.3,
    fits: (a) => a.water < 0.3 && a.grass < 0.28 && a.alt < 0.35,
  },
  // Foothills get scattered boulders; the mountains themselves are relief, not sprites.
  { kind: 'boulder', count: byElevation([0, 0, 0, 1, 1]), chance: 0.35, spacing: 0.4, fits: dry },
];

