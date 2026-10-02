import { neighbourIndices } from '../tiles/hydrology';
import { stepWater, type Forcing, type WaterWorld } from './hexWater';

/**
 * Scripted weather for the water model: phases of rain, a cloudburst,
 * drought, run step by step from a start, keeping every state so a view can
 * play it or jump to any moment.
 */

/** One stretch of weather: rain and evaporation per step (steps of water), for `steps` steps. */
export interface WaterPhase extends Forcing {
  label: string;
  steps: number;
  /** Water poured once at the start of the phase, per cell. */
  burst?: ArrayLike<number>;
}

export type WaterScript = readonly WaterPhase[];

export const scriptLength = (script: WaterScript) => script.reduce((n, p) => n + p.steps, 0);

/** The step at which the phase called `label` ends (the script's end if there is none). */
export function phaseEnd(script: WaterScript, label: string): number {
  const k = script.findIndex((p) => p.label === label);
  return scriptLength(k < 0 ? script : script.slice(0, k + 1));
}

/** The phase that leads to the state at `step` (the first phase for the start). */
export function phaseAt(script: WaterScript, step: number): WaterPhase {
  let end = 0;
  for (const phase of script) if (step <= (end += phase.steps)) return phase;
  return script[script.length - 1];
}

/** The world with `amount` more water per cell (none on the sea and the map's edge). */
export function pour(w: WaterWorld, amount: ArrayLike<number>): WaterWorld {
  return { ...w, depth: w.depth.map((d, i) => (w.sink[i] ? d : d + amount[i])) };
}

/**
 * Every state of the run: index k is the world after k steps. Water flows
 * `rounds` times per step (rain and evaporation shared out over them), so a
 * full lake drains through its outlet without piling up far above it.
 */
export function runScript(start: WaterWorld, script: WaterScript, rounds = ROUNDS): WaterWorld[] {
  const states = [start];
  let w = start;
  for (const phase of script) {
    const share = { rain: typeof phase.rain === 'number' ? phase.rain / rounds : Float32Array.from(phase.rain, (r) => r / rounds), evaporation: phase.evaporation / rounds };
    for (let k = 0; k < phase.steps; k++) {
      if (k === 0 && phase.burst) w = pour(w, phase.burst);
      for (let r = 0; r < rounds; r++) w = stepWater(w, share);
      states.push(w);
    }
  }
  return states;
}

/** Connected groups of cells holding water (`water[i] > 0`). */
export function basins(cols: number, rows: number, water: ArrayLike<number>): number[][] {
  const map = { cols, rows, elevation: [] };
  const seen = new Uint8Array(cols * rows);
  const groups: number[][] = [];
  for (let start = 0; start < cols * rows; start++) {
    if (seen[start] || !(water[start] > 0)) continue;
    const cells = [start];
    seen[start] = 1;
    for (let k = 0; k < cells.length; k++) {
      for (const j of neighbourIndices(map, cells[k])) {
        if (seen[j] || !(water[j] > 0)) continue;
        seen[j] = 1;
        cells.push(j);
      }
    }
    groups.push(cells);
  }
  return groups;
}

/** Flow rounds per step of a run. */
const ROUNDS = 4;
/** Steps per phase of the basin script, and how hard it rains, bursts and dries. */
const PACE = { dry: 8, rain: 120, burst: 120, drought: 150 };
/** Rain fills each basin this many times over in the rain phase, so it ends overflowing. */
const OVERFILL = 1.25;
/** Water a cloudburst pours on one side of each basin, in steps. */
const BURST = 1.2;

/**
 * A run through the life of high lakes, given the water `full` basins hold
 * (per cell): dry, then rain fills every basin until it overflows, then a
 * cloudburst piles water up on one side of each lake and it levels out, then
 * a drought dries them all again.
 */
export function basinScript(cols: number, rows: number, full: ArrayLike<number>): WaterScript {
  const n = cols * rows;
  const rain = new Float32Array(n);
  const burst = new Float32Array(n);
  const colOf = (i: number) => (i % cols) + (Math.floor(i / cols) & 1) * 0.5;
  for (const cells of basins(cols, rows, full)) {
    const volume = cells.reduce((v, i) => v + full[i], 0);
    const middle = cells.reduce((x, i) => x + colOf(i), 0) / cells.length;
    for (const i of cells) {
      rain[i] = (OVERFILL * volume) / (cells.length * PACE.rain);
      burst[i] = colOf(i) < middle ? BURST : 0;
    }
  }
  const deepest = Math.max(0, ...Array.from(full)) * OVERFILL + BURST;
  return [
    { label: 'Dry', steps: PACE.dry, rain: 0, evaporation: 0 },
    { label: 'Rain', steps: PACE.rain, rain, evaporation: 0 },
    { label: 'Cloudburst, one side', steps: PACE.burst, rain: 0, evaporation: 0, burst },
    { label: 'Drought', steps: PACE.drought, rain: 0, evaporation: (1.2 * deepest) / PACE.drought },
  ];
}
