import { mix, shade, type RGB } from '../rendering/palette';
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
/** Mountain water: deep, cold blue over dark stone, never a sandy lagoon. */
const ALPINE_WATER: RGB = [30, 86, 140];
/** How dark wet stone gets along a mountain lake. */
const WET_STONE = 0.82;
const FOAM: RGB = [250, 252, 255];
const WATERLINE = 0.43;

/** Altitude band over which ground turns to bare rock, and then to snow. */
export const ROCK_LINE = [0.45, 0.6] as const;
export const SNOW_LINE = [0.88, 0.97] as const;
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
 * Above the rock line water turns alpine: wet stone instead of wet sand,
 * deep cold blue instead of a clear lagoon, and hardly any surf, so a
 * mountain lake never reads as lying at sea level.
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
  const alpine = smoothstep(ROCK_LINE[0], ROCK_LINE[1], a.alt);
  c = over(c, 'rock', Math.max(alpine, smoothstep(BARE_ROCK_LINE[0], BARE_ROCK_LINE[1], a.alt) * bare));
  c = over(c, 'snow', smoothstep(SNOW_LINE[0], SNOW_LINE[1], a.alt));
  c = over(c, 'wetSand', smoothstep(0.1, 0.27, a.water) * (1 - alpine));
  c = mix(c, shade(c, WET_STONE), smoothstep(0.22, 0.36, a.water) * alpine); // a narrow wet rim on stone

  const surface = smoothstep(0.38, 0.42, a.water);
  if (surface <= 0) return c;
  const depth = smoothstep(0.45, 1, a.water);
  const water = mix(mix(texel('water'), DEEP, depth * 0.75), ALPINE_WATER, alpine * (0.55 + 0.3 * depth));
  const opacity = 0.6 + 0.4 * depth;
  c = mix(c, water, surface * (opacity + (1 - opacity) * 0.7 * alpine));
  return mix(c, FOAM, foamAmount(a.water) * (1 - 0.8 * alpine));
}
