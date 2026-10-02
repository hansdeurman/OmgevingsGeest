import { DEFAULT_EROSION, erodeStep, type ErosionParams } from './erosion';
import { hexTopology, type HexTopology } from './hexTopology';
import { DEFAULT_FLOW, flowStep, type FlowParams } from './pipeFlow';
import { soakMap, weatherStep, type Soak, type SoakMap, type Weather } from './retention';

/**
 * Water on a hex map: what stands on each hex, what flows through each pipe,
 * what the ground holds and what lies as snow or ice, and the ground itself,
 * which running water slowly wears down. Each step the weather acts on every
 * hex, then water flows and carries ground along. All state lives in flat typed arrays
 * and steps work in place, so a world of very many hexes stays cheap.
 */
export interface HydroWorld {
  topo: HexTopology;
  ground: Float32Array;
  /** 1 where water leaves the map: the sea and the map's edge. */
  sink: Uint8Array;
  soak: SoakMap;
  /** Standing and running water per hex (steps). */
  depth: Float32Array;
  /** Flow per pipe (steps of water per step), index hex * dirs + direction. */
  flux: Float32Array;
  /** Water held in the ground, and snow and ice, per hex (steps). */
  soil: Float32Array;
  snow: Float32Array;
  /** Ground carried by the water, and how hard each hex is to wear away (0–1). */
  sediment: Float32Array;
  hardness: Float32Array;
}

export interface HydroInit {
  cols: number;
  rows: number;
  ground: ArrayLike<number>;
  soak: (i: number) => Soak;
  depth?: (i: number) => number;
  snow?: (i: number) => number;
  hardness?: (i: number) => number;
  /** Pipes per hex: 6 (edges) or 12 (edges and corners). */
  dirs?: 6 | 12;
}

/** What a view needs of one moment: the water, the flow, the snow and the ground as worn so far. */
export interface HydroSnapshot {
  depth: Float32Array;
  flux: Float32Array;
  snow: Float32Array;
  ground: Float32Array;
}

/** Flow rounds per step: water moves this many times per round of weather. */
export const ROUNDS = 2;

export function createHydroWorld({ cols, rows, ground, soak, depth, snow, hardness, dirs = 12 }: HydroInit): HydroWorld {
  const n = cols * rows;
  const topo = hexTopology(cols, rows, dirs);
  const edge = (i: number) => i % cols === 0 || i % cols === cols - 1 || i < cols || i >= n - cols;
  return {
    topo,
    ground: Float32Array.from(ground),
    sink: Uint8Array.from({ length: n }, (_, i) => (edge(i) || ground[i] <= 0 ? 1 : 0)),
    soak: soakMap(Array.from({ length: n }, (_, i) => soak(i))),
    depth: Float32Array.from({ length: n }, (_, i) => depth?.(i) ?? 0),
    flux: new Float32Array(n * dirs),
    soil: new Float32Array(n),
    snow: Float32Array.from({ length: n }, (_, i) => snow?.(i) ?? 0),
    sediment: new Float32Array(n),
    hardness: Float32Array.from({ length: n }, (_, i) => hardness?.(i) ?? 0.5),
  };
}

/** One step, in place: the weather, then `rounds` of flow, each wearing the ground. */
export function stepHydro(w: HydroWorld, weather: Weather, rounds = ROUNDS, flow: FlowParams = DEFAULT_FLOW, erosion: ErosionParams = DEFAULT_EROSION): void {
  weatherStep(w.ground, w.depth, w.soil, w.snow, w.soak, weather);
  for (let r = 0; r < rounds; r++) {
    flowStep(w.topo, w.ground, w.depth, w.flux, w.sink, flow);
    erodeStep(w.topo, w.ground, w.depth, w.flux, w.sediment, w.hardness, w.sink, erosion);
  }
}

export const snapshot = (w: HydroWorld): HydroSnapshot => ({ depth: w.depth.slice(), flux: w.flux.slice(), snow: w.snow.slice(), ground: w.ground.slice() });

export function totalWater(depth: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < depth.length; i++) sum += depth[i];
  return sum;
}
