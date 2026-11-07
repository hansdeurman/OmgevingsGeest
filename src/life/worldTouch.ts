import type { WaterCycle } from '../water/waterCycle';
import { MOST_WIND } from '../water/wind';
import type { Influence } from './powers';

/**
 * The creatures' powers worked on a water cycle's world, after its step:
 * heat into the air and (half as much) the ground, a push on the wind and
 * the wind stilled, and water moved, never made or lost: cloud into rain or
 * back into vapour, standing water (or the sea, or wet soil) lifted into the
 * air as it evaporates, standing water frozen into ice.
 */
export function touchWorld(c: WaterCycle, f: Influence): void {
  const { heat, wind, air, world } = c;
  for (let i = 0; i < f.heat.length; i++) {
    heat.air[i] += f.heat[i];
    heat.surface[i] += f.heat[i] / 2;
    pushWind(wind.x, wind.y, i, f.gustX[i], f.gustY[i], f.still[i]);
    air.fall[i] += share(air.cloud, i, f.rain[i]);
    air.vapour[i] += share(air.cloud, i, f.thin[i]);
    air.rise[i] += air.sea[i] ? fromSea(c, f.mist[i]) : fromGround(c, i, f.mist[i]);
    if (!air.sea[i]) world.snow[i] += share(world.depth, i, f.freeze[i]);
  }
}

/** Take up to `want` from `a` at `i`: what was taken. */
const take = (a: Float32Array, i: number, want: number) => {
  const got = Math.max(0, Math.min(a[i], want));
  a[i] -= got;
  return got;
};

/** Take the share `s` (at most all) of `a` at `i`: what was taken. */
const share = (a: Float32Array, i: number, s: number) => take(a, i, a[i] * Math.min(1, s));

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
