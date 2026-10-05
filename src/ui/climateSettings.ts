import type { ClimateParams } from '../water/waterCycle';
import { beaufort, METRES_PER_SECOND } from './windOverlay';

/**
 * The climate's settings a player can tweak, as sliders: the sun and how
 * the world keeps its heat, how the wind is pushed and held back, and how
 * water rises and rains. And a few words on the weather now.
 */
export interface ClimateSetting<G extends keyof ClimateParams = keyof ClimateParams> {
  group: G;
  key: keyof ClimateParams[G] & string;
  label: string;
  /** What it does, for a tooltip. */
  hint: string;
  min: number;
  max: number;
  step: number;
}

const setting = <G extends keyof ClimateParams>(s: ClimateSetting<G>): ClimateSetting => s as unknown as ClimateSetting;

export const CLIMATE_SETTINGS: readonly ClimateSetting[] = [
  setting({ group: 'heat', key: 'sun', label: 'Sun', hint: 'How strong the sun shines: the only heat from outside', min: 1.5, max: 4, step: 0.05 }),
  setting({ group: 'heat', key: 'tilt', label: 'Seasons', hint: 'How much stronger the summer sun is than the winter sun', min: 0, max: 0.6, step: 0.02 }),
  setting({ group: 'heat', key: 'greenhouse', label: 'Greenhouse', hint: 'How much of its heat the air holds back from space', min: 0, max: 0.6, step: 0.02 }),
  setting({ group: 'heat', key: 'seaMemory', label: 'Sea warmth', hint: 'How much more heat the sea holds than land: how slowly it warms and cools', min: 2, max: 40, step: 1 }),
  setting({ group: 'heat', key: 'mixing', label: 'Air mixing', hint: 'How fast the air over each spot mixes with the whole sky', min: 0, max: 0.3, step: 0.01 }),
  setting({ group: 'wind', key: 'push', label: 'Wind force', hint: 'How hard differences in warmth push the wind', min: 0, max: 1.5, step: 0.05 }),
  setting({ group: 'wind', key: 'friction', label: 'Friction', hint: 'How much the ground slows the wind', min: 0.3, max: 3, step: 0.05 }),
  setting({ group: 'wind', key: 'turning', label: 'Earth spin', hint: 'How hard the spin of the world turns the wind (0: at the equator)', min: 0, max: 1.5, step: 0.05 }),
  setting({ group: 'wind', key: 'eddies', label: 'Weather systems', hint: 'How strong passing highs and lows are', min: 0, max: 4, step: 0.1 }),
  setting({ group: 'air', key: 'evaporate', label: 'Evaporation', hint: 'How fast water evaporates into dry, windy air', min: 0, max: 0.05, step: 0.001 }),
  setting({ group: 'air', key: 'humidity', label: 'Humidity', hint: 'How humid air over water gets', min: 0.5, max: 1, step: 0.01 }),
  setting({ group: 'air', key: 'rainFrom', label: 'Rain from', hint: 'How thick a cloud gets before it rains', min: 0.01, max: 0.2, step: 0.005 }),
  setting({ group: 'air', key: 'rainRate', label: 'Rain rate', hint: 'How fast a thick cloud rains out', min: 0.01, max: 0.3, step: 0.01 }),
];

export const valueOf = (p: ClimateParams, s: ClimateSetting) => (p[s.group] as unknown as Record<string, number>)[s.key];

export function setValue(p: ClimateParams, s: ClimateSetting, v: number): void {
  (p[s.group] as unknown as Record<string, number>)[s.key] = v;
}

const COMPASS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];

/** Where the wind (x east, y south) blows from, as a compass point. */
export const windFrom = (x: number, y: number) => COMPASS[(Math.round(Math.atan2(-y, -x) / (Math.PI / 4)) + 8) % 8];

/** The weather now in a few words: the sea's and the air's warmth over the lowland and the peaks, and the wind (where from, how fast, its force). */
export function climateReadout(sky: { temperature: ArrayLike<number>; surface: ArrayLike<number>; windX: ArrayLike<number>; windY: ArrayLike<number> }, heights: ArrayLike<number>): string {
  const cells = Array.from({ length: heights.length }, (_, i) => i);
  const mean = (a: ArrayLike<number>, of: number[]) => (of.length ? of.reduce((s, i) => s + a[i], 0) / of.length : NaN);
  const [sea, low, peaks] = [cells.filter((i) => heights[i] <= 0), cells.filter((i) => heights[i] > 0 && heights[i] < 2), cells.filter((i) => heights[i] >= 6)];
  const [x, y] = [mean(sky.windX, cells), mean(sky.windY, cells)];
  const speed = mean(Float32Array.from(cells, (i) => Math.hypot(sky.windX[i], sky.windY[i])), cells) * METRES_PER_SECOND;
  const deg = (v: number) => (Number.isNaN(v) ? '–' : `${Math.round(v)}°`);
  return `Sea ${deg(mean(sky.surface, sea))} · land ${deg(mean(sky.temperature, low))} · peaks ${deg(mean(sky.temperature, peaks))} · wind ${windFrom(x, y)} ${Math.round(speed)} m/s, Bft ${beaufort(speed)}`;
}
