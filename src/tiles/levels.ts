import { clamp } from '../math/scalar';

/**
 * Cover layers painted on top of the sand base. Each hex stores one level per
 * layer; the renderer turns levels into a continuous amount and blends them
 * across hex edges, so gradations need no extra tile art.
 */
export const LAYERS = ['water', 'grass', 'trees'] as const;
export type Layer = (typeof LAYERS)[number];

export const MAX_LEVEL = 4;
export type Level = 0 | 1 | 2 | 3 | 4;

/** Per-hex cover: one discrete level per layer. */
export type Cover = Record<Layer, Level>;

/** Continuous per-point cover, roughly in [0, 1] per layer. */
export type Amounts = Record<Layer, number>;

export const LEVEL_NAMES: Record<Layer, readonly string[]> = {
  water: ['dry sand', 'damp sand', 'shallows', 'water', 'deep water'],
  grass: ['bare sand', 'first tufts', 'patchy grass', 'meadow', 'lush meadow'],
  trees: ['no trees', 'first tree', 'grove', 'woodland', 'dense forest'],
};

export function levelAmount(level: number): number {
  return clamp(level / MAX_LEVEL, 0, 1);
}

export function zeroAmounts(): Amounts {
  return { water: 0, grass: 0, trees: 0 };
}
