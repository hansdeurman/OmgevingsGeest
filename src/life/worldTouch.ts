import { smoothstep, soft } from '../math/scalar';
import { saturation } from '../water/atmosphere';
import type { WaterCycle } from '../water/waterCycle';
import { MOST_WIND } from '../water/wind';
import type { Influence } from './powers';

/**
 * The creatures' (and the avatar's) powers worked on a water cycle's world,
 * after its step: heat into the air and (half as much) the ground, a push
 * on the wind and the wind stilled, and water moved, never made or lost:
 * water drawn from the sea into cloud (rain called where there was none),
 * that cloud held together (kept from dissolving into the air), cloud into rain, cloud and the damp air under it burnt off and ground
 * dried by the sun (that water carried off over the sea, so it does not
 * gather again where it was), standing water (or the sea, or wet soil) lifted into the
 * air, standing water frozen into ice (most readily in the cold; in the
 * warm it melts again).
 * Powers nudge the world, they do not shove it: however many pile up on a
 * hex, what they do there in a step tails off towards a most (`LIMITS`), and
 * the world's own ways (wind, mixing, radiation, rain) keep working against
 * them, so a place can be made warmer, wetter or calmer, but the climate is
 * not overturned.
 */
export function touchWorld(c: WaterCycle, f: Influence): void {
  const { heat, wind, air, world } = c;
  const humidity = c.params.air.humidity;
  let away = 0;
  for (let i = 0; i < f.heat.length; i++) {
    const warm = soft(f.heat[i], LIMITS.heat);
    heat.air[i] += warm;
    heat.surface[i] += warm / 2;
    pushWind(wind.x, wind.y, i, soft(f.gustX[i], LIMITS.gust), soft(f.gustY[i], LIMITS.gust), soft(f.still[i], LIMITS.still));
    air.kept[i] = soft(f.keep[i], 1);
    air.cloud[i] += fromSea(c, soft(f.gather[i], LIMITS.gather));
    air.fall[i] += share(air.cloud, i, soft(f.rain[i], LIMITS.share));
    const thin = soft(f.thin[i], LIMITS.thin);
    away += share(air.cloud, i, thin) + share(air.vapour, i, thin);
    if (!air.sea[i]) away += fromGround(c, i, soft(f.dry[i], LIMITS.mist));
    const room = Math.max(0, humidity * saturation(c.temperature[i]) - air.vapour[i] - air.rise[i]);
    const lift = Math.min(soft(f.mist[i], LIMITS.mist), room);
    air.rise[i] += fromWater(c, i, lift);
    if (!air.sea[i]) world.snow[i] += share(world.depth, i, soft(f.freeze[i], LIMITS.share) * (WARM_FREEZE + (1 - WARM_FREEZE) * smoothstep(COLD.from, COLD.full, c.temperature[i])));
  }
  c.sea += away;
}

/** The most powers do on a hex in a step, all together: heat (°C), a push on the wind (hex spacings per step), the share of the wind stilled, the share of its cloud rained out or of standing water frozen, the share of its cloud burnt off, water lifted into the air or dried from the ground, and drawn from the sea into cloud (steps). */
export const LIMITS = { heat: 0.4, gust: 0.1, still: 0.8, share: 0.6, thin: 0.5, mist: 0.02, gather: 0.03 };
/** Standing water freezes readily from this air temperature (°C), fully at this one; in the warm, a share as readily (and it melts again). */
const COLD = { from: 2, full: -4 };
const WARM_FREEZE = 0.3;

/** Take up to `want` from `a` at `i`: what was taken. */
const take = (a: Float32Array, i: number, want: number) => {
  const got = Math.max(0, Math.min(a[i], want));
  a[i] -= got;
  return got;
};

/** Take the share `s` (at most all) of `a` at `i`: what was taken. */
const share = (a: Float32Array, i: number, s: number) => take(a, i, a[i] * Math.min(1, s));

/** Water from the sea, or what stands on hex `i` and then its soil. */
const fromWater = (c: WaterCycle, i: number, want: number) => (c.air.sea[i] ? fromSea(c, want) : fromGround(c, i, want));

/** Water from what stands on hex `i`, then from its soil. */
function fromGround(c: WaterCycle, i: number, want: number): number {
  const standing = take(c.world.depth, i, want);
  return standing + take(c.world.soil, i, want - standing);
}

function fromSea(c: WaterCycle, want: number): number {
  const got = Math.max(0, Math.min(c.sea, want));
  c.sea -= got;
  return got;
}

function pushWind(x: Float32Array, y: Float32Array, i: number, gx: number, gy: number, still: number): void {
  const [u, v] = [x[i] * (1 - still) + gx, y[i] * (1 - still) + gy];
  const over = Math.hypot(u, v) / MOST_WIND;
  [x[i], y[i]] = over > 1 ? [u / over, v / over] : [u, v];
}
