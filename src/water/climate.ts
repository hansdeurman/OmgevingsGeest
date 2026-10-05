import { fbm2D, valueNoise2D } from '../math/noise';
import { smoothstep } from '../math/scalar';

/**
 * The climate a map's weather comes from, step by step: the year's warmth
 * (seasons), the wind (from one side mostly, slowly turning and gusting as
 * weather comes and goes) and weather systems, patches of rising air that
 * drift with the wind. All follows from the seed and the step, so any
 * moment can be worked out again.
 */

/** Steps in a year. */
export const YEAR = 640;

export type Season = 'winter' | 'spring' | 'summer' | 'autumn';
const SEASONS: readonly Season[] = ['winter', 'spring', 'summer', 'autumn'];

/** The season of a share of the year (0: midwinter, 0.5: midsummer). */
export const seasonOf = (share: number): Season => SEASONS[Math.floor((((share + 0.125) % 1) + 1) % 1 * 4) % 4];

export interface ClimateNow {
  /** Share of the year gone since midwinter. */
  yearShare: number;
  /** -1 midwinter … 1 midsummer. */
  warmth: number;
  /** How fast open water evaporates (steps per step, at its full rate). */
  evaporation: number;
  /** Hex spacings per step, x east, y south. */
  wind: { x: number; y: number };
}

export interface Climate {
  at(step: number): ClimateNow;
  /** Into `out`, per hex of a `cols` x `rows` map: how much weather systems lift the air there now (0–1). */
  lift(step: number, cols: number, rows: number, out: Float32Array): Float32Array;
}

/** The run opens this far into the year: spring. */
const OPENS = 0.25;
/** Open water evaporates this fast at midsummer, not at all in midwinter. */
const EVAPORATION = 0.012;
/** The wind: its least speed and how much gusts add, how far it turns from where it mostly comes from, and over how many steps it turns and gusts. */
const WIND = { calm: 0.15, gust: 0.3, swing: 1.2, turn: 90, gusts: 60 };
/** Weather systems: their size (hex spacings), and how high the noise must be for any lift and for full lift. */
const SYSTEMS = { size: 9, from: 0.55, full: 0.72 };

export function createClimate(seed: number): Climate {
  const prevailing = valueNoise2D(seed * 7.3, 0.5, 99) * 2 * Math.PI;
  const wind = (step: number) => {
    const angle = prevailing + WIND.swing * (2 * valueNoise2D(step / WIND.turn, 0.5, seed) - 1);
    const speed = WIND.calm + WIND.gust * valueNoise2D(step / WIND.gusts, 7.5, seed + 1);
    return { x: speed * Math.cos(angle), y: speed * Math.sin(angle) };
  };
  /** How far the air has drifted by each step, summed as asked. */
  const drift = [{ x: 0, y: 0 }];
  const driftAt = (step: number) => {
    for (let k = drift.length; k <= step; k++) {
      const [d, w] = [drift[k - 1], wind(k - 1)];
      drift.push({ x: d.x + w.x, y: d.y + w.y });
    }
    return drift[step];
  };
  const noise = { seed: seed * 13 + 5, octaves: 3, persistence: 0.5, lacunarity: 2 };

  return {
    at(step) {
      const yearShare = (step / YEAR + OPENS) % 1;
      const warmth = -Math.cos(2 * Math.PI * yearShare);
      return { yearShare, warmth, evaporation: (EVAPORATION * (1 + warmth)) / 2, wind: wind(step) };
    },
    lift(step, cols, rows, out) {
      const d = driftAt(Math.max(0, Math.floor(step)));
      for (let row = 0; row < rows; row++) {
        const y = (row * Math.sqrt(3)) / 2 - d.y;
        for (let col = 0; col < cols; col++) {
          const x = col + (row & 1) / 2 - d.x;
          out[row * cols + col] = smoothstep(SYSTEMS.from, SYSTEMS.full, fbm2D(x / SYSTEMS.size, y / SYSTEMS.size, noise));
        }
      }
      return out;
    },
  };
}
