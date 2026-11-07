import { BESTIARY } from './bestiary';

/**
 * How the kinds are doing, as a whole: how many of each there are, and the
 * most of each there have been. A kind that was many and is down to its
 * last few is about to vanish.
 */
export interface Population {
  counts: ArrayLike<number>;
  peaks: ArrayLike<number>;
}

/** Down to this few, from at least `WAS`, a kind is about to vanish. */
export const FEW = 2;
const WAS = 5;

export const isVanishing = (p: Population, kind: number) => !BESTIARY[kind].mystic && p.counts[kind] > 0 && p.counts[kind] <= FEW && p.peaks[kind] >= WAS;

/** The kinds about to vanish now. */
export const vanishingKinds = (p: Population) => BESTIARY.flatMap((_, k) => (isVanishing(p, k) ? [k] : []));
