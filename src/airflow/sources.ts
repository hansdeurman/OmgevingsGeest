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

/** Reactive list of placed sources. Mutated via add/clear and watched by Vue. */
export const windSources = reactive<WindSource[]>([]);

/** UI state: when true, dragging on the canvas places a source instead of panning. */
export const placingSource = ref(false);

export function addSource(s: WindSource): void {
  windSources.push(s);
}

export function clearSources(): void {
  windSources.splice(0, windSources.length);
}
