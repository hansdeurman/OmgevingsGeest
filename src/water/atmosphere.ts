import { carry, divergence } from './airGrid';
import { hexTopology, type HexTopology } from './hexTopology';

/**
 * The water in the air over a hex map: per hex the vapour the air carries
 * and the cloud it has condensed into, both moved by the wind and never
 * lost (the map's edges are closed: the world is the map). Warm air holds
 * more vapour than cold air, so air the wind drives up a mountainside
 * cools, its vapour condenses into cloud and heavy clouds rain (or snow)
 * on the slope; behind the ridge it comes down, warms, and its clouds
 * dissolve. Where the wind closes in the air rises and clouds form; where
 * it spreads out the air sinks and clears. Water comes into the air only
 * by evaporating: from the sea (drawn from it), from lakes, rivers, the
 * soil through its plants, and snow (`rise`, from the ground's model), as
 * much as the air over it takes: the more, the warmer that water, the
 * drier and windier the air (Dalton's law), up to the humidity air over
 * water keeps (drier air from above mixes in). Water in steps; wind in hex
 * spacings per step; temperatures in °C.
 */
export interface Air {
  topo: HexTopology;
  /** The ground the air lies on (the sea's surface: 0): rising ground holds the wind back. */
  floor: Float32Array;
  sea: Uint8Array;
  vapour: Float32Array;
  cloud: Float32Array;
  /** Rain or snow that fell from each hex's clouds in the last step. */
  fall: Float32Array;
  /** Water that rose from the ground of each hex since the last step: taken up next step. */
  rise: Float32Array;
  /** How much water the air over each hex would take up now (steps): open water gives all of it. */
  demand: Float32Array;
  /** Water that evaporated into each hex's air in the last step (it cooled that surface), and that condensed there (it warmed the air; below 0: cloud evaporated). */
  evaporated: Float32Array;
  condensed: Float32Array;
  /** How much the wind spreads out at each hex (closing in: below 0). */
  spread: Float32Array;
}

/** The air's surroundings this step, per hex: its own temperature, that of the surface under it, the wind. */
export interface Sky {
  temperature: ArrayLike<number>;
  surface: ArrayLike<number>;
  windX: ArrayLike<number>;
  windY: ArrayLike<number>;
}

export interface AirParams {
  /** Share of the vapour beyond what the air holds that condenses per step… */
  condense: number;
  /** …and of what it could still hold that its cloud gives back as vapour. */
  dissolve: number;
  /** Cloud (steps) above which it rains, and the share of the rest that falls per step. */
  rainFrom: number;
  rainRate: number;
  /** Share of what the air could still take up from water under it that it takes per step in still air, and how much more per hex spacing of wind per step. */
  evaporate: number;
  gust: number;
  /** Water gives air at most this humid (share of what air as warm as the water holds): drier air from above keeps mixing in. */
  humidity: number;
  /** How much each step of rising ground holds the wind back. */
  block: number;
  /** How much less the air holds where the wind closes in (it rises and cools), and more where it spreads out (it sinks and warms), per unit of closing in. */
  rising: number;
}

export const DEFAULT_AIR: AirParams = {
  condense: 0.5,
  dissolve: 0.3,
  rainFrom: 0.05,
  rainRate: 0.05,
  evaporate: 0.015,
  gust: 2,
  humidity: 0.8,
  block: 0.1,
  rising: 0.15,
};

/** Vapour (steps) saturated air holds at 0°, and how much more per degree warmer (about 7% per degree: Clausius–Clapeyron). */
const SATURATION = { at0: 0.35, perDegree: 0.07 };
/** Sea ice forms below this temperature, and gives the air only a share of what open sea would. */
const SEA_ICE = { below: -1.8, gives: 0.15 };
/** Rising air holds at most this much less. */
const MOST_LIFT = 0.6;

/** The most vapour air this warm (°) holds. */
export const saturation = (t: number) => SATURATION.at0 * Math.exp(SATURATION.perDegree * t);

export function createAir(cols: number, rows: number, ground: ArrayLike<number>, sea: Uint8Array): Air {
  const n = cols * rows;
  const array = () => new Float32Array(n);
  return {
    topo: hexTopology(cols, rows, 6),
    floor: Float32Array.from(ground, (g) => Math.max(0, g)),
    sea,
    vapour: array(),
    cloud: array(),
    fall: array(),
    rise: array(),
    demand: array(),
    evaporated: array(),
    condensed: array(),
    spread: array(),
  };
}

/** Air this humid (share of what it holds) everywhere, without clouds: a start that needs little spin-up. */
export function humidAir(air: Air, temperature: ArrayLike<number>, humidity = 0.8): void {
  air.vapour.forEach((_, i) => (air.vapour[i] = humidity * saturation(temperature[i])));
  air.cloud.fill(0);
}

/** How much water the air over each hex would take up now, into `air.demand`. */
export function airDemand(air: Air, sky: Sky, p: AirParams = DEFAULT_AIR): void {
  for (let i = 0; i < air.demand.length; i++) {
    const wind = Math.hypot(sky.windX[i], sky.windY[i]);
    air.demand[i] = p.evaporate * (1 + p.gust * wind) * Math.max(0, p.humidity * saturation(sky.surface[i]) - air.vapour[i]);
  }
}

/**
 * One step of the air, in place: what rose is taken up and the sea gives
 * what is asked of it, the wind carries vapour and cloud, vapour and cloud
 * trade places, heavy clouds fall (into `fall`). Returns the water drawn
 * from the sea.
 */
export function airStep(air: Air, sky: Sky, p: AirParams = DEFAULT_AIR): number {
  const { sea, vapour, cloud, fall, rise, demand, evaporated, condensed, spread } = air;
  let drawn = 0;
  for (let i = 0; i < vapour.length; i++) {
    const fromSea = sea[i] ? demand[i] * (sky.surface[i] < SEA_ICE.below ? SEA_ICE.gives : 1) : 0;
    evaporated[i] = rise[i] + fromSea;
    vapour[i] += evaporated[i];
    drawn += fromSea;
    rise[i] = 0;
  }
  carry(air.topo, vapour, sky.windX, sky.windY, air.floor, p.block);
  carry(air.topo, cloud, sky.windX, sky.windY, air.floor, p.block);
  divergence(air.topo, sky.windX, sky.windY, spread);
  for (let i = 0; i < vapour.length; i++) {
    const lift = Math.min(MOST_LIFT, p.rising * Math.max(0, -spread[i]));
    const holds = saturation(sky.temperature[i]) * (1 - lift) * (1 + p.rising * Math.max(0, spread[i]));
    const beyond = vapour[i] - holds;
    const trade = beyond > 0 ? p.condense * beyond : -Math.min(cloud[i], p.dissolve * -beyond);
    vapour[i] -= trade;
    cloud[i] += trade;
    condensed[i] = trade;
    fall[i] = cloud[i] > p.rainFrom ? p.rainRate * (cloud[i] - p.rainFrom) : 0;
    cloud[i] -= fall[i];
  }
  return drawn;
}
