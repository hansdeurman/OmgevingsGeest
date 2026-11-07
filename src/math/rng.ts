/**
 * Tiny seeded RNG (mulberry32). Deterministic and dependency-free.
 */
export function mulberry32(seed: number): () => number {
  const r = rngOf(seed);
  return () => random(r);
}

/** The RNG's whole state, so a run can keep it and set it back. */
export interface Rng {
  s: number;
}

export const rngOf = (seed: number): Rng => ({ s: seed >>> 0 });

/** The next number in [0, 1), moving the state on. */
export function random(r: Rng): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
