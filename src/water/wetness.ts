import { piecewise } from '../math/scalar';

/**
 * How wet a hex is, on one scale the map's look follows: parched, dry,
 * normal, moist, soaked, and from `flooded` on under water, the deeper the
 * wetter. In between the scale runs smoothly, so ground dries out and soaks
 * up gradually.
 */
export const WETNESS = { parched: 0, dry: 1, normal: 2, moist: 3, soaked: 4, flooded: 5, deep: 6 } as const;

/** From how full the ground is (share of what it can hold): a wide band of ordinary ground is normal. */
const BY_SOIL = piecewise([
  [0.02, WETNESS.parched],
  [0.2, WETNESS.dry],
  [0.4, WETNESS.normal],
  [0.75, WETNESS.normal],
  [0.95, WETNESS.moist],
]);

/** From the water standing on it (steps): a film is nothing, puddles soak it, more than the ground takes is a lake. */
const BY_WATER = piecewise([
  [0.005, WETNESS.parched],
  [0.02, WETNESS.moist],
  [0.06, WETNESS.soaked],
  [0.25, WETNESS.flooded],
  [3, WETNESS.deep],
]);

/** Wetness of a hex whose ground is `fill` full and on which `depth` steps of water stand. */
export const wetness = (fill: number, depth: number) => Math.max(BY_SOIL(fill), BY_WATER(depth));

/** Wetness per hex. On `sink` hexes (the sea, the map's edge) only the soil counts: what flows in there is gone. */
export function wetnessMap(capacity: ArrayLike<number>, soil: ArrayLike<number>, depth: ArrayLike<number>, sink?: ArrayLike<number>): Float32Array {
  const out = new Float32Array(soil.length);
  for (let i = 0; i < out.length; i++) out[i] = wetness(capacity[i] > 0 ? soil[i] / capacity[i] : 0, sink?.[i] ? 0 : depth[i]);
  return out;
}
