import { reactive, ref } from 'vue';

/**
 * A user-placed wind generator. While "on", it forces velocity (and density,
 * if non-zero) at its cell to its configured (vx, vy, density) — Dirichlet
 * boundary, predictable visuals, no source-cell dynamics, while neighbouring
 * cells advect normally.
 *
 * `duration` and `period` together describe a duty cycle:
 *   - duration = Infinity (or duration >= period): always on (continuous).
 *   - 0 < duration < period: fires for `duration` seconds out of every
 *     `period` seconds. Phase is tracked internally and advances each step.
 *
 * Lifetime properties are snapshotted at placement and never change for that
 * source — the user sets them ahead of time, then leaves the source alone.
 */
export interface WindSource {
  col: number;
  row: number;
  vx: number;
  vy: number;
  /** Density injected while "on". 0 for velocity-only sources. */
  density: number;
  /** Seconds the source is "on" per cycle. Use Infinity for always-on. */
  duration: number;
  /** Cycle length in seconds. Use Infinity (or any value) when always-on. */
  period: number;
  /** Internal phase tracker, advances by dt and wraps modulo period. */
  phase: number;
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

/**
 * UI state: which kind of source is created when the user mouseups after a
 * placement drag. Locked in *before* placement begins; the resulting source
 * keeps that nature for its lifetime (continuous sources persist in
 * `windSources`; bursts are one-shot via `windBursts`).
 */
export type PlacementMode = 'continuous' | 'burst';
export const placementMode = ref<PlacementMode>('continuous');

/**
 * Lightweight constructor: callers supply position + velocity, optionally
 * override the burst-cycle fields. Defaults yield an always-on continuous
 * source matching the legacy behaviour.
 */
export function addSource(s: {
  col: number;
  row: number;
  vx: number;
  vy: number;
  density?: number;
  duration?: number;
  period?: number;
}): void {
  windSources.push({
    col: s.col,
    row: s.row,
    vx: s.vx,
    vy: s.vy,
    density: s.density ?? 0,
    duration: s.duration ?? Infinity,
    period: s.period ?? Infinity,
    phase: 0,
  });
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
