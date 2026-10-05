/**
 * The sun: the one thing that comes into the map's world from outside. It
 * shines more in summer than in winter, by how far the world is tilted;
 * everything else (the warmth, the wind, the weather) follows from it.
 */

/** Steps in a year. */
export const YEAR = 640;

export type Season = 'winter' | 'spring' | 'summer' | 'autumn';
const SEASONS: readonly Season[] = ['winter', 'spring', 'summer', 'autumn'];

/** A run opens this far into the year (since midwinter): in spring. */
const OPENS = 0.25;

/** Share of the year gone since midwinter at `step`. */
export const yearShare = (step: number) => (((step / YEAR + OPENS) % 1) + 1) % 1;

/** The season of a share of the year (0: midwinter, 0.5: midsummer). */
export const seasonOf = (share: number): Season => SEASONS[Math.floor(((share + 0.125) % 1) * 4) % 4];

export interface SunParams {
  /** Sunlight over a year, on average (heat per step: what warms bare ground about a degree). */
  sun: number;
  /** Share by which the summer sun is stronger than the average, and the winter sun weaker. */
  tilt: number;
}

/** The sunlight at a share of the year. */
export const sunlight = (share: number, p: SunParams) => p.sun * (1 - p.tilt * Math.cos(2 * Math.PI * share));
