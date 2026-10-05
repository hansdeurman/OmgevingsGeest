import type { Puff } from './cloudDeck';

/**
 * The puffs as instances for the GPU: where each cloud sprite and each
 * shaft of rain or snow goes on the canvas.
 */

/** Where the sky goes on the canvas (canvas px = offset + frame px * scale, y squashed), and how high (frame px) the clouds float. */
export interface SkyView {
  scale: number;
  x: number;
  y: number;
  squash: number;
  altitude: number;
}

/** A cloud sprite's height over its width. */
export const CLOUD_ASPECT = 2 / 3;
/** Floats per cloud: centre x, y (canvas px), width, shape, dark, shown. */
export const CLOUD_INSTANCE = 6;
/** Floats per shaft: left, top, width, height (canvas px), how hard it falls, snow (1) or rain (0), seed. */
export const RAIN_INSTANCE = 7;
/** A shaft is as wide as this share of its cloud; it hangs from this share of the cloud's height below its middle to as far below its ground. */
const SHAFT = { width: 0.6, from: 0.1, below: 0.3 };
/** Clouds raining less than this show no shaft. */
const RAINS = 0.05;

const groundY = (p: Puff, v: SkyView) => v.y + p.y * v.squash * v.scale;
const centre = (p: Puff, v: SkyView) => ({ x: v.x + p.x * v.scale, y: groundY(p, v) - v.altitude * v.scale });

export function cloudInstances(puffs: readonly Puff[], view: SkyView): Float32Array {
  const shown = puffs.filter((p) => p.shown > 0 && p.size > 0).sort((a, b) => a.y - b.y);
  const out = new Float32Array(shown.length * CLOUD_INSTANCE);
  shown.forEach((p, k) => {
    const c = centre(p, view);
    out.set([c.x, c.y, p.size * view.scale, p.shape, p.dark, p.shown], k * CLOUD_INSTANCE);
  });
  return out;
}

export function rainInstances(puffs: readonly Puff[], view: SkyView): Float32Array {
  const raining = puffs.filter((p) => p.fall * p.shown > RAINS);
  const out = new Float32Array(raining.length * RAIN_INSTANCE);
  raining.forEach((p, k) => {
    const c = centre(p, view);
    const w = p.size * view.scale;
    const h = w * CLOUD_ASPECT;
    const top = c.y + SHAFT.from * h;
    const bottom = groundY(p, view) + SHAFT.below * h;
    out.set([c.x - (SHAFT.width * w) / 2, top, SHAFT.width * w, bottom - top, p.fall * p.shown, p.snow ? 1 : 0, p.seed % 1000], k * RAIN_INSTANCE);
  });
  return out;
}
