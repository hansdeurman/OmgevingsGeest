import { smoothstep } from '../math/scalar';

/**
 * How the season looks on the ground, per hex, as the simulation has it
 * now: how much snow covers the land, how much ice the water (sea and
 * lakes too cold), how lush the plants are (0 grazed bare or dried up – 1
 * as full as the hex grows), and how much greener than it was painted the
 * land has grown. The ground is painted once; these colour it as the world
 * changes.
 */
export interface SeasonLook {
  snow: Float32Array;
  ice: Float32Array;
  vigour: Float32Array;
  lush: Float32Array;
}

/** What the look is worked out from: one moment of the run. */
export interface SeasonState {
  snow: ArrayLike<number>;
  depth: ArrayLike<number>;
  ground: ArrayLike<number>;
  /** Surface temperatures (°C). */
  surface: ArrayLike<number>;
  plants: ArrayLike<number>;
  /** The most plants each hex grows now. */
  room: ArrayLike<number>;
}

/** Snow (steps of water) from which it shows, and covers fully; surface °C at which water starts to freeze, and is frozen; lakes this deep show ice; hexes growing this little show no plants; plants this far above what the hex was painted with show it greener, and fully. */
const SNOW = [0.004, 0.1] as const;
const ICE = [-0.5, -4] as const;
const LAKE = 0.3;
const BARE = 0.05;
const LUSH = [0.05, 0.45] as const;

/** The look of the season `s` on a map whose plants were painted as `painted` (the most each hex grew as drawn). */
export function seasonLook(s: SeasonState, painted: ArrayLike<number>): SeasonLook {
  const n = s.snow.length;
  const look: SeasonLook = { snow: new Float32Array(n), ice: new Float32Array(n), vigour: new Float32Array(n), lush: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    const water = s.ground[i] <= 0 || s.depth[i] > LAKE;
    look.snow[i] = water ? 0 : smoothstep(SNOW[0], SNOW[1], s.snow[i]);
    look.ice[i] = water ? Math.max(smoothstep(ICE[0], ICE[1], s.surface[i]), s.ground[i] > 0 ? smoothstep(SNOW[0], SNOW[1], s.snow[i]) : 0) : 0;
    look.vigour[i] = s.room[i] > BARE ? Math.min(1, s.plants[i] / s.room[i]) : 1;
    look.lush[i] = water ? 0 : smoothstep(LUSH[0], LUSH[1], s.plants[i] - painted[i]);
  }
  return look;
}
