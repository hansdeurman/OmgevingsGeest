import { neighbourIndices } from '../tiles/hydrology';
import { snapshot, stepHydro, type HydroSnapshot, type HydroWorld } from './hydroWorld';
import type { Weather } from './retention';

/**
 * Scripted weather for the water model: phases of snow, rain, a cloudburst
 * and drought, run step by step, keeping a snapshot of every step so a view
 * can play it back or jump to any moment.
 */

/** One stretch of weather, for `steps` steps. */
export interface WaterPhase extends Weather {
  label: string;
  steps: number;
  /** Water poured once at the start of the phase, per hex. */
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

/** Pour `amount` more water on every hex, in place (none on the sea and the map's edge). */
export function pour(w: HydroWorld, amount: ArrayLike<number>): void {
  for (let i = 0; i < w.depth.length; i++) if (!w.sink[i]) w.depth[i] += amount[i];
}

/** Take step `k` (from 0) of the script on `world`: its phase's weather, after the phase's burst if it starts here. */
export function stepScript(world: HydroWorld, script: WaterScript, k: number): void {
  let start = 0;
  for (const phase of script) {
    if (k < start + phase.steps) {
      if (k === start && phase.burst) pour(world, phase.burst);
      stepHydro(world, phase);
      return;
    }
    start += phase.steps;
  }
}

/** Run the script on `world` (which it changes): index k of the result is the moment after k steps. */
export function runScript(world: HydroWorld, script: WaterScript): HydroSnapshot[] {
  const states = [snapshot(world)];
  for (let k = 0; k < scriptLength(script); k++) {
    stepScript(world, script, k);
    states.push(snapshot(world));
  }
  return states;
}

/** Connected groups of hexes holding water (`water[i] > 0`). */
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

/** Steps per phase of the season script. */
const PACE = { winter: 40, spring: 160, burst: 80, summer: 220, storm: 40, autumn: 100 };
/** Rain per step on the lowlands; the mountains catch more, up to `mountains` times as much. */
const RAIN = { lowland: 0.003, mountains: 3 };
/** Water a cloudburst pours on one side of each basin, in steps. */
const BURST = 1.2;
/** How many times the usual rain an autumn storm brings. */
const STORM = 12;

/**
 * A year in the life of high lakes, given each hex's ground and the water
 * `full` basins hold: a winter that lays snow on the heights, spring rain that
 * soaks the land, runs off in streams and fills the basins until they
 * overflow, a cloudburst that piles water up on one side of each lake until it
 * levels out, a dry summer in which the lakes sink while glaciers keep the
 * rivers running and the land dries out, and an autumn storm that soaks the
 * land and floods its flats and hollows, which then slowly drain.
 */
export function seasonScript(cols: number, rows: number, ground: ArrayLike<number>, full: ArrayLike<number>, years = 1): WaterScript {
  const n = cols * rows;
  const rain = Float32Array.from({ length: n }, (_, i) => RAIN.lowland * (1 + ((RAIN.mountains - 1) * Math.max(0, ground[i])) / 8));
  const burst = new Float32Array(n);
  const colOf = (i: number) => (i % cols) + (Math.floor(i / cols) & 1) * 0.5;
  for (const cells of basins(cols, rows, full)) {
    const middle = cells.reduce((x, i) => x + colOf(i), 0) / cells.length;
    for (const i of cells) burst[i] = colOf(i) < middle ? BURST : 0;
  }
  const year: WaterPhase[] = [
    { label: 'Winter', steps: PACE.winter, rain, warmth: -0.8, evaporation: 0 },
    { label: 'Spring rain', steps: PACE.spring, rain: rain.map((r) => r * 1.5), warmth: 0.3, evaporation: 0.002 },
    { label: 'Cloudburst, one side', steps: PACE.burst, rain: 0, warmth: 0.5, evaporation: 0.004, burst },
    { label: 'Dry summer', steps: PACE.summer, rain: 0, warmth: 1, evaporation: 0.012 },
    { label: 'Autumn storm', steps: PACE.storm, rain: rain.map((r) => r * STORM), warmth: 0.4, evaporation: 0.001 },
    { label: 'Autumn', steps: PACE.autumn, rain: rain.map((r) => r * 0.5), warmth: 0.1, evaporation: 0.004 },
  ];
  return Array.from({ length: years }, (_, y) => year.map((p) => (y ? { ...p, label: `${p.label}, year ${y + 1}` } : p))).flat();
}
