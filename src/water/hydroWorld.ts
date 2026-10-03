import { channelStep, createChannels, type Channels } from './channels';
import { DEFAULT_EROSION, erodeStep, type ErosionParams } from './erosion';
import { hexTopology, type HexTopology } from './hexTopology';
import { DEFAULT_FLOW, flowStep, type FlowParams } from './pipeFlow';
import { soakMap, weatherStep, type Soak, type SoakMap, type Weather } from './retention';
import { wetnessMap } from './wetness';

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
  /** The rivers the water runs in, and the beds it has worn. */
  channels: Channels;
}

export interface HydroInit {
  cols: number;
  rows: number;
  ground: ArrayLike<number>;
  soak: (i: number) => Soak;
  depth?: (i: number) => number;
  /** Water the ground holds at the start (steps); dry if absent. */
  soil?: (i: number) => number;
  snow?: (i: number) => number;
  hardness?: (i: number) => number;
  /** Pipes per hex: 6 (edges) or 12 (edges and corners). */
  dirs?: 6 | 12;
}

/** What a view needs of one moment: the water, the flow, the snow, the ground as worn so far, how wet each hex is and its river. */
export interface HydroSnapshot {
  depth: Float32Array;
  flux: Float32Array;
  snow: Float32Array;
  ground: Float32Array;
  /** Per hex, on the WETNESS scale. */
  wetness: Float32Array;
  river: RiverState;
}

/** Per hex: water running through now, the flow its bed was worn for, and the hex the river runs on to (-1: none). */
export interface RiverState {
  flow: Float32Array;
  bed: Float32Array;
  down: Int32Array;
}

/** Flow rounds per step: water moves this many times per round of weather. */
export const ROUNDS = 2;

export function createHydroWorld({ cols, rows, ground, soak, depth, soil, snow, hardness, dirs = 12 }: HydroInit): HydroWorld {
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
    soil: Float32Array.from({ length: n }, (_, i) => soil?.(i) ?? 0),
    snow: Float32Array.from({ length: n }, (_, i) => snow?.(i) ?? 0),
    sediment: new Float32Array(n),
    hardness: Float32Array.from({ length: n }, (_, i) => hardness?.(i) ?? 0.5),
    channels: createChannels(topo),
  };
}

/** One step, in place: the weather, then `rounds` of flow, each wearing the ground. */
export function stepHydro(w: HydroWorld, weather: Weather, rounds = ROUNDS, flow: FlowParams = DEFAULT_FLOW, erosion: ErosionParams = DEFAULT_EROSION): void {
  weatherStep(w.ground, w.depth, w.soil, w.snow, w.soak, weather);
  for (let r = 0; r < rounds; r++) {
    flowStep(w.topo, w.ground, w.depth, w.flux, w.sink, flow);
    erodeStep(w.topo, w.ground, w.depth, w.flux, w.sediment, w.hardness, w.sink, erosion);
  }
  channelStep(w.topo, w.ground, w.flux, w.sink, w.channels);
}

export const snapshot = (w: HydroWorld): HydroSnapshot => ({
  depth: w.depth.slice(),
  flux: w.flux.slice(),
  snow: w.snow.slice(),
  ground: w.ground.slice(),
  wetness: wetnessMap(w.soak.capacity, w.soil, w.depth, w.sink),
  river: {
    flow: w.channels.flow.slice(),
    bed: w.channels.bed.slice(),
    down: w.channels.down.slice(),
  },
});

/** What changes as a world runs, copied out, so it can be set back to this moment. */
export interface WorldState {
  arrays: Float32Array[];
  channels: { flow: Float32Array; bed: Float32Array; down: Int32Array; order: Int32Array; age: number };
}

const changing = (w: HydroWorld) => [w.ground, w.depth, w.flux, w.soil, w.snow, w.sediment];

export const saveWorld = (w: HydroWorld): WorldState => ({
  arrays: changing(w).map((a) => a.slice()),
  channels: { flow: w.channels.flow.slice(), bed: w.channels.bed.slice(), down: w.channels.down.slice(), order: w.channels.order.slice(), age: w.channels.age },
});

/** Set `w` back to a moment saved from it. */
export function restoreWorld(w: HydroWorld, state: WorldState): void {
  changing(w).forEach((a, k) => a.set(state.arrays[k]));
  const { flow, bed, down, order, age } = state.channels;
  w.channels.flow.set(flow);
  w.channels.bed.set(bed);
  w.channels.down.set(down);
  Object.assign(w.channels, { order: order.slice(), age });
}

export function totalWater(depth: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < depth.length; i++) sum += depth[i];
  return sum;
}
