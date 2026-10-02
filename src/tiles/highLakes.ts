import { tileableValueNoise2D, valueNoise2D } from '../math/noise';
import { clamp } from '../math/scalar';
import { shade, type RGB } from '../rendering/palette';
import type { LakeArt, LakeState } from './lakePainter';
import type { GroundTextures } from './placeholderTextures';
import { paintRaster } from './raster';
import type { LakeShape } from './shores';
import type { WallStrip } from './wallStrip';
import { lakeTemperature, type WaterTextures, type Wind } from './waterLook';

/**
 * From what the world knows about a high lake (its water, the level at which
 * it overflows, the season, the wind) to what the lake painter needs: its
 * temperature and outflow, and which walls and water to paint it with.
 */

export const WALL_STYLES = ['mossy', 'grey', 'snowy'] as const;
export type WallStyle = (typeof WALL_STYLES)[number];

/** All the art high lakes are painted with. */
export interface LakeKit {
  walls: Record<WallStyle, WallStrip>;
  /** Near walls the lake spills over, ever harder. */
  spill: WallStrip[];
  outfall: WallStrip;
  water: WaterTextures;
}

/** The weather over the lakes; for now the same for every lake. */
export interface Weather {
  /** -1 winter … 1 summer. */
  warmth: number;
  wind: Wind;
}

export const DEFAULT_WEATHER: Weather = { warmth: 0, wind: { strength: 0.25, direction: 0.4 } };

/** Where a lake overflows: the level (steps) at which it starts to pour out, and where (frame px). */
export interface Overflow {
  full: number;
  outlet?: { x: number; y: number };
}

/** A lake pours out once it is this close to its overflow level (steps)… */
const POURS_WITHIN = 0.05;
/** …and spills over its whole near rim from this far above it, hardest this much further up. */
const SPILL_FROM = 0.15;
const SPILL_RANGE = 0.5;
/** Elevation (steps) up to which lake walls are mossy, and from which they are snowy. */
const MOSS_BELOW = 3.6;
const SNOW_FROM = 6.6;

export const wallStyle = (level: number): WallStyle => (level < MOSS_BELOW ? 'mossy' : level < SNOW_FROM ? 'grey' : 'snowy');

/** One lake's temperature, wind and outflow: it pours out of its outlet once it reaches its overflow level. */
export function lakeState(shape: LakeShape, weather: Weather, overflow?: Overflow): LakeState {
  const above = overflow ? shape.top - overflow.full : -Infinity;
  return {
    spill: clamp((above - SPILL_FROM) / SPILL_RANGE, 0, 1),
    temperature: lakeTemperature(shape.level, weather.warmth),
    wind: weather.wind,
    outlet: above >= -POURS_WITHIN ? overflow?.outlet : undefined,
  };
}

/** The art for one lake: walls in the style of its height, a spilling near wall when it spills, its rim from the ground art. */
export function lakeArt(kit: LakeKit, level: number, spill: number, ground: GroundTextures): LakeArt {
  const style = wallStyle(level);
  return {
    wall: kit.walls[style],
    spillWall: spill > 0 ? kit.spill[Math.min(kit.spill.length - 1, Math.floor(spill * kit.spill.length))] : undefined,
    outfall: kit.outfall,
    rim: (style === 'snowy' ? ground.snow : ground.rock)[0],
    water: kit.water,
  };
}

/** Plain stand-ins for the painted lake art, so lakes draw before (or without) it. */
export function placeholderLakeKit(size: number): LakeKit {
  const [w, h] = [Math.round(2.2 * size), Math.round(1.6 * size)];
  const strip = (face: RGB, top: RGB): WallStrip => ({
    image: paintRaster(w, h, (x, y) => (y < 3 ? top : shade(face, (x % 9 ? 1 : 0.72) * (0.9 + 0.2 * valueNoise2D(x * 0.3, y * 0.08, 5))))),
    lip: 3,
    from: Math.round(h * 0.35),
    to: Math.round(h * 0.65),
  });
  const water = (c: RGB, seed: number) => paintRaster(32, 32, (x, y) => shade(c, 0.94 + 0.12 * tileableValueNoise2D(x / 8, y / 8, 4, seed)));
  return {
    walls: { mossy: strip([108, 116, 80], [146, 158, 104]), grey: strip([122, 108, 94], [172, 160, 144]), snowy: strip([118, 110, 106], [236, 240, 244]) },
    spill: [strip([118, 116, 120], [180, 200, 214]), strip([116, 128, 144], [196, 216, 230]), strip([150, 178, 204], [214, 232, 242])],
    outfall: strip([200, 226, 242], [226, 240, 250]),
    water: { ice: water([206, 228, 240], 1), cold: water([44, 92, 134], 2), mild: water([70, 140, 152], 3), warm: water([84, 142, 108], 4) },
  };
}
