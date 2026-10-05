import { smoothstep } from '../math/scalar';
import { advect, mix } from './airGrid';
import { hexTopology, type HexTopology } from './hexTopology';
import { LAPSE } from './retention';
import { sunlight, type SunParams } from './sun';

/**
 * Heat on the map, from the one thing that comes in from outside: the sun.
 * Per hex the temperature of its surface (ground, lake or sea) and of the
 * air over it. The sun warms the surface, less where it is bright (snow,
 * sand) or under clouds, and the air a little; surface and air trade heat,
 * the faster the more wind; evaporating water cools the surface and the
 * water condensing into clouds warms the air; both radiate heat to space
 * (the air less the more it holds back: its greenhouse, and its clouds).
 * The wind carries the air's heat and neighbouring air mixes. The sea
 * holds far more heat than land, so it warms and cools slowly, and later.
 * Heat is in what warms bare ground by one degree; the air's temperature
 * is kept as at sea level, LAPSE colder per step up (air the wind drives
 * up a mountain cools as it rises).
 */
export interface Heat {
  topo: HexTopology;
  /** The ground under the air (steps; the sea's surface: 0). */
  height: Float32Array;
  /** Temperature (°C) of each hex's surface, at its own height. */
  surface: Float32Array;
  /** Temperature (°C) of the air over each hex, brought to sea level. */
  air: Float32Array;
  work: Float32Array;
}

export interface HeatParams extends SunParams {
  /** How much more heat the sea holds than bare ground, per degree. */
  seaMemory: number;
  /** Share of its heat the air holds back instead of radiating it to space. */
  greenhouse: number;
  /** Share of the way to the whole sky's mean temperature the air over each hex goes per step: over a map this small the free air is much the same everywhere, and warmth a mountain or a shower gives its air rises and spreads. */
  mixing: number;
}

export const DEFAULT_HEAT: HeatParams = { sun: 2.65, tilt: 0.32, seaMemory: 15, greenhouse: 0.3, mixing: 0.05 };

/** What each hex's surface is like now: how much sunlight it throws back, and how much heat it holds per degree. */
export interface Surface {
  albedo: ArrayLike<number>;
  capacity: ArrayLike<number>;
}

/** What else moves heat this step, per hex: cloud cover (0–1), water evaporated from the surface and condensed in the air (steps), the wind. */
export interface HeatFlows {
  cloud: ArrayLike<number>;
  evaporated: ArrayLike<number>;
  condensed: ArrayLike<number>;
  windX: ArrayLike<number>;
  windY: ArrayLike<number>;
}

/** How much light bare surfaces throw back. */
export const ALBEDO = { sea: 0.07, water: 0.08, ice: 0.45, snow: 0.55, forest: 0.13, grass: 0.19, sand: 0.3, rock: 0.24 };

/** How bright a hex's bare ground is, from its grass and tree levels (0–4) and height: forest darkest, sand brightest, rock high up between. */
export function albedoOf(grass: number, trees: number, elevation: number): number {
  const plants = trees ? ALBEDO.forest + (ALBEDO.grass - ALBEDO.forest) * (1 - trees / 4) : grass ? ALBEDO.grass + (ALBEDO.sand - ALBEDO.grass) * (1 - grass / 4) * 0.5 : ALBEDO.sand;
  const rock = smoothstep(4.5, 6.5, elevation);
  return plants + (ALBEDO.rock - plants) * rock;
}

/** Heat the air over a hex holds per degree. */
const AIR_HOLDS = 2;
/** Share of the sunlight the air takes up on its way down. */
const IN_AIR = 0.2;
/** Heat surface and air trade per degree between them, and how much more per hex spacing of wind per step. */
const TRADE = { still: 0.3, wind: 2 };
/** Heat radiated to space per degree above SPACE: by the surface, straight through the air, and by the air. */
const RADIATES = { surface: 0.02, air: 0.05 };
const SPACE = -30;
/** Share of the sunlight a full cloud cover keeps off, and of the air's radiation it holds back. */
const CLOUD = { shade: 0.6, trap: 0.35 };
/** Heat it takes to evaporate one step of water (and that condensing it gives back). */
export const LATENT = 150;
/** Share of the heat condensing water gives that stays in the air where it condenses; the rest the rising air carries up and away, warming the whole sky. */
const LATENT_HERE = 0.3;
/** Air mixes with its neighbours this much more than with the whole sky. */
const NEIGHBOURS = 0.5;

export function createHeat(cols: number, rows: number, ground: ArrayLike<number>, start: number): Heat {
  const n = cols * rows;
  const height = Float32Array.from(ground, (g) => Math.max(0, g));
  return {
    topo: hexTopology(cols, rows, 6),
    height,
    surface: Float32Array.from(height, (h) => start - LAPSE * h),
    air: new Float32Array(n).fill(start),
    work: new Float32Array(n),
  };
}

/** The air's own temperature over hex i. */
export const airTemperature = (h: Heat, i: number) => h.air[i] - LAPSE * h.height[i];

/** Heat that came and went over the steps it was kept for, all hexes together: sunlight taken up, radiated to space, taken by evaporating water and given back by condensing water. */
export interface HeatBudget {
  sun: number;
  space: number;
  evaporating: number;
  condensing: number;
}

export const emptyBudget = (): HeatBudget => ({ sun: 0, space: 0, evaporating: 0, condensing: 0 });

/** One step of heat at `share` of the year, in place; what came and went is added to `budget`, if given. */
export function heatStep(h: Heat, share: number, surface: Surface, flows: HeatFlows, p: HeatParams = DEFAULT_HEAT, budget?: HeatBudget): void {
  const { height, air, work } = h;
  const ts = h.surface;
  const sun = sunlight(share, p);
  const outAir = RADIATES.air * (1 - p.greenhouse);
  let aloft = 0;
  for (let i = 0; i < ts.length; i++) {
    const cover = flows.cloud[i];
    const ta = air[i] - LAPSE * height[i];
    const light = sun * (1 - CLOUD.shade * cover);
    const cs = surface.capacity[i];
    // Surface and air trade heat toward the same temperature: worked out exactly, so it stays steady at any rate.
    const rate = TRADE.still * (1 + TRADE.wind * Math.hypot(flows.windX[i], flows.windY[i]));
    const each = 1 / cs + 1 / AIR_HOLDS;
    const gap = ts[i] - ta;
    const traded = (gap * (1 - Math.exp(-rate * each))) / each;
    const [onGround, window] = [light * (1 - surface.albedo[i]) * (1 - IN_AIR), RADIATES.surface * (ts[i] - SPACE)];
    // The air radiates from high up, where it is as warm everywhere as its sea-level temperature says: mountains do not warm their own sky.
    const [inAir, out] = [light * IN_AIR, outAir * (1 - CLOUD.trap * cover) * (air[i] - SPACE)];
    const condensing = LATENT * flows.condensed[i];
    ts[i] += (onGround - window - LATENT * flows.evaporated[i] - traded) / cs;
    air[i] += (inAir + traded + LATENT_HERE * condensing - out) / AIR_HOLDS;
    aloft += (1 - LATENT_HERE) * condensing;
    if (!budget) continue;
    budget.sun += onGround + inAir;
    budget.space += window + out;
    budget.evaporating += LATENT * flows.evaporated[i];
    budget.condensing += LATENT * flows.condensed[i];
  }
  advect(h.topo, air, flows.windX, flows.windY, work);
  air.set(work);
  mix(h.topo, air, NEIGHBOURS * p.mixing, work);
  let mean = 0;
  for (let i = 0; i < air.length; i++) mean += air[i];
  mean /= air.length;
  const spread = aloft / air.length / AIR_HOLDS;
  for (let i = 0; i < air.length; i++) air[i] += spread + (mean - air[i]) * p.mixing;
}
