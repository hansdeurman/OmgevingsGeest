import { reactive, ref } from 'vue';

/**
 * A user-placed wind generator: at this hex, force the wind vector to be
 * exactly (vx, vy) every step. Acts as a Dirichlet boundary condition for
 * the simulation — predictable visuals, no source-cell dynamics, while
 * neighbouring cells advect normally.
 */
export interface WindSource {
  col: number;
  row: number;
  vx: number;
  vy: number;
}

/**
 * A one-shot impulse: stamp (vx, vy) and `density` onto a single cell exactly
 * once, then forget. Used by the test-burst tooling to fire a clean parcel of
 * air in a chosen direction so we can watch it propagate in isolation.
 *
 * Bursts are *consumed* by the simulation each step — the queue is drained
 * after `step()` returns. Re-firing means pushing a new burst.
 */
export interface WindBurst {
  col: number;
  row: number;
  vx: number;
  vy: number;
  density: number;
}

/** Reactive list of placed sources. Mutated via add/clear and watched by Vue. */
export const windSources = reactive<WindSource[]>([]);

/** Pending one-shot impulses. Drained by the per-frame simulator wiring. */
export const windBursts = reactive<WindBurst[]>([]);

/**
 * Set to true to ask the next simulation tick to zero velocity AND density
 * before applying any bursts/sources. Consumed (set back to false) by the
 * frame loop. The test-burst tooling flips this so each test fires onto a
 * clean slate.
 */
export const requestFieldClear = ref(false);

/** UI state: when true, dragging on the canvas places a source instead of panning. */
export const placingSource = ref(false);

export function addSource(s: WindSource): void {
  windSources.push(s);
}

export function clearSources(): void {
  windSources.splice(0, windSources.length);
}

export function fireBurst(b: WindBurst): void {
  windBursts.push(b);
}

export function clearBursts(): void {
  windBursts.splice(0, windBursts.length);
}
