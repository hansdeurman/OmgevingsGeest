import { mix, type RGB } from '../rendering/palette';
import { smoothstep } from '../math/scalar';
import type { Amounts } from './levels';

/**
 * Ground textures. Sand, grass, water, rock and snow are the plain terrains;
 * the other three are the single "fuse" texture per neighbouring pair:
 *   wetSand     — water ↔ sand
 *   sparseGrass — sand  ↔ grass
 *   forestFloor — grass ↔ forest
 */
export const GROUND_KINDS = ['sand', 'wetSand', 'sparseGrass', 'grass', 'forestFloor', 'water', 'rock', 'snow'] as const;
export type GroundKind = (typeof GROUND_KINDS)[number];

export type TexelLookup = (kind: GroundKind) => RGB;

const DEEP: RGB = [22, 90, 168];
const FOAM: RGB = [250, 252, 255];
const WATERLINE = 0.43;

/** Altitude band over which ground turns to bare rock, and then to snow. */
export const ROCK_LINE = [0.45, 0.6] as const;
export const SNOW_LINE = [0.78, 0.9] as const;
/** Lower band where ground without grass is rock instead of sand: beaches stay near the sea. */
export const BARE_ROCK_LINE = [0.22, 0.36] as const;

/** Ground under trees is at least this green, so forests never stand on bare sand. */
export const grassUnderTrees = (a: Amounts) => Math.max(a.grass, Math.min(1, a.trees * 1.5));

export function foamAmount(water: number): number {
  return Math.max(0, 1 - Math.abs(water - WATERLINE) / 0.035) * 0.85;
}

/**
 * Colour of one ground point. Layers stack bottom-up: sand, the sand/grass
 * fuse, grass, forest floor, rock and snow with altitude, wet sand, then
 * translucent water with foam on its edge. Each step only samples its texture when it actually shows.
 */
export function shadeGround(a: Amounts, texel: TexelLookup): RGB {
  const over = (c: RGB, kind: GroundKind, t: number): RGB =>
    t <= 0 ? c : t >= 1 ? texel(kind) : mix(c, texel(kind), t);

  const grass = grassUnderTrees(a);
  let c = texel('sand');
  c = over(c, 'sparseGrass', smoothstep(0.28, 0.4, grass));
  c = over(c, 'grass', smoothstep(0.42, 0.55, grass));
  c = over(c, 'forestFloor', smoothstep(0.5, 0.85, a.trees));
  const bare = 1 - smoothstep(0.3, 0.6, grass);
  const rock = Math.max(smoothstep(ROCK_LINE[0], ROCK_LINE[1], a.alt), smoothstep(BARE_ROCK_LINE[0], BARE_ROCK_LINE[1], a.alt) * bare);
  c = over(c, 'rock', rock);
  c = over(c, 'snow', smoothstep(SNOW_LINE[0], SNOW_LINE[1], a.alt));
  c = over(c, 'wetSand', smoothstep(0.1, 0.27, a.water));

  const surface = smoothstep(0.38, 0.42, a.water);
  if (surface <= 0) return c;
  const depth = smoothstep(0.45, 1, a.water);
  const water = mix(texel('water'), DEEP, depth * 0.75);
  c = mix(c, water, surface * (0.6 + 0.4 * depth));
  return mix(c, FOAM, foamAmount(a.water));
}
