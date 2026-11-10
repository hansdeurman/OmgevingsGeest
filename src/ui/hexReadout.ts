import { OVERCAST } from '../water/waterCycle';
import { WETNESS } from '../water/wetness';

/**
 * What a developer reads of one hex, to see a gift do what it says: the
 * air's temperature, how cloudy it is, what falls, how wet the ground is,
 * the plants on it against the most it grows now (and was painted with,
 * if it has greened since), and the snow on it.
 */
export interface HexView {
  temperature: ArrayLike<number>;
  cloud: ArrayLike<number>;
  fall: ArrayLike<number>;
  /** On the WETNESS scale. */
  wetness: ArrayLike<number>;
  snow: ArrayLike<number>;
  plants: ArrayLike<number>;
  room: ArrayLike<number>;
}

const WET_NAMES = Object.keys(WETNESS) as (keyof typeof WETNESS)[];
/** Snow (steps of water) worth telling; how much more a hex must grow than painted to tell it. */
const SNOW_SHOWS = 0.004;
const GREENED = 0.02;

const wetName = (w: number) => WET_NAMES[Math.max(0, Math.min(WET_NAMES.length - 1, Math.round(w)))];

/** The hex `i` of `v`, in one short line; `painted`: the most each hex grew as the map was painted. */
export function hexReadout(v: HexView, i: number, painted: ArrayLike<number>): string {
  const parts = [
    `🌡 ${v.temperature[i].toFixed(1)}°`,
    `☁ ${Math.round(100 * Math.min(1, v.cloud[i] / OVERCAST))}%`,
    `🌧 ${v.fall[i].toFixed(3)}`,
    `💧 ${wetName(v.wetness[i])} ${v.wetness[i].toFixed(1)}`,
    `🌱 ${v.plants[i].toFixed(2)}/${v.room[i].toFixed(2)}${v.room[i] > painted[i] + GREENED ? ` (was ${painted[i].toFixed(2)})` : ''}`,
  ];
  if (v.snow[i] > SNOW_SHOWS) parts.push(`❄ ${v.snow[i].toFixed(2)}`);
  return parts.join(' · ');
}
