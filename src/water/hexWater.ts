import { neighbourIndices } from '../tiles/hydrology';

/**
 * Water on a hex map, cell by cell: every step each cell passes water to
 * neighbours whose surface (ground + water) lies lower, in proportion to the
 * difference, so an uneven lake levels out over a number of steps and water
 * never runs uphill. Rain adds water, evaporation takes it, and the sea and
 * the map's edge swallow whatever reaches them. Heights are in terrace steps.
 */
export interface WaterWorld {
  readonly cols: number;
  readonly rows: number;
  readonly ground: Float32Array;
  /** Water on each cell, in steps. */
  readonly depth: Float32Array;
  /** Neighbour cells of each cell. */
  readonly neighbours: readonly Int32Array[];
  /** 1 where water leaves the map: the sea and the map's edge. */
  readonly sink: Uint8Array;
}

/** What comes in and goes out per step, in steps of water: rain everywhere or per cell. */
export interface Forcing {
  rain: number | ArrayLike<number>;
  evaporation: number;
}

/**
 * Share of a surface difference that flows to a lower neighbour per step.
 * Below 1/7, so a cell with six lower neighbours never drops below them.
 */
export const FLOW = 0.12;

export function createWaterWorld(cols: number, rows: number, ground: ArrayLike<number>, depth?: ArrayLike<number>): WaterWorld {
  const n = cols * rows;
  const map = { cols, rows, elevation: Array.from(ground) };
  const edge = (i: number) => i % cols === 0 || i % cols === cols - 1 || i < cols || i >= n - cols;
  return {
    cols,
    rows,
    ground: Float32Array.from(ground),
    depth: depth ? Float32Array.from(depth) : new Float32Array(n),
    neighbours: Array.from({ length: n }, (_, i) => Int32Array.from(neighbourIndices(map, i))),
    sink: Uint8Array.from({ length: n }, (_, i) => (edge(i) || ground[i] <= 0 ? 1 : 0)),
  };
}

export const surfaceOf = (w: WaterWorld, i: number) => w.ground[i] + w.depth[i];

export const totalWater = (w: WaterWorld) => w.depth.reduce((a, b) => a + b, 0);

/** The world one step later; the given one is left as it was. */
export function stepWater(w: WaterWorld, forcing: Forcing): WaterWorld {
  const n = w.depth.length;
  const surface = Float32Array.from({ length: n }, (_, i) => surfaceOf(w, i));
  // Each cell may not give away more than it holds: scale its outflows down if they would.
  const scale = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let out = 0;
    for (const j of w.neighbours[i]) out += Math.max(0, surface[i] - surface[j]);
    out *= FLOW;
    scale[i] = out > w.depth[i] ? w.depth[i] / out : 1;
  }
  const depth = w.depth.slice();
  for (let i = 0; i < n; i++) {
    if (!w.depth[i]) continue;
    for (const j of w.neighbours[i]) {
      const q = FLOW * Math.max(0, surface[i] - surface[j]) * scale[i];
      depth[i] -= q;
      depth[j] += q;
    }
  }
  const rain = (i: number) => (typeof forcing.rain === 'number' ? forcing.rain : forcing.rain[i]);
  for (let i = 0; i < n; i++) depth[i] = w.sink[i] ? 0 : Math.max(0, depth[i] + rain(i) - forcing.evaporation);
  return { ...w, depth };
}
