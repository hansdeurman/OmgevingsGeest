import type { Pixel } from '../math/hex';
import { valueNoise2D } from '../math/noise';
import { smoothstep } from '../math/scalar';
import { mix, shade, type RGB } from '../rendering/palette';
import { getPixel, setPixel, type Raster } from './raster';

/**
 * Raised water ("pools"): a high lake drawn as water held above the land,
 * with a stone lip around it and a waterfall where it pours out.
 * Pools are pixel masks over the ground raster (1 = raised water).
 */

const FALL_DEEP: RGB = [92, 172, 222];
const FALL_FOAM: RGB = [238, 247, 255];
const LIP: RGB = [200, 186, 162];

/** Falling water at depth `k` px below the lip: vertical foam streaks over blue, brighter toward the bottom. */
export function waterfallColor(x: number, py: number, k: number): RGB {
  const streak = valueNoise2D(x * 0.55, py * 0.1, 31);
  return mix(FALL_DEEP, FALL_FOAM, smoothstep(0.3, 0.75, streak) * 0.8 + smoothstep(2, 10, k) * 0.2);
}

/** The 4-neighbours of pixel `i` inside a W×H raster. */
function neighbours4(i: number, W: number, H: number): number[] {
  const x = i % W;
  const out: number[] = [];
  if (x > 0) out.push(i - 1);
  if (x < W - 1) out.push(i + 1);
  if (i >= W) out.push(i - W);
  if (i < W * (H - 1)) out.push(i + W);
  return out;
}

/** Pixels reachable from the raster border without crossing the pool. */
function openLand(pool: Uint8Array, W: number, H: number): Uint8Array {
  const open = new Uint8Array(W * H);
  const stack: number[] = [];
  const visit = (i: number) => {
    if (pool[i] || open[i]) return;
    open[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < W; x++) [x, (H - 1) * W + x].forEach(visit);
  for (let y = 0; y < H; y++) [y * W, y * W + W - 1].forEach(visit);
  while (stack.length) neighbours4(stack.pop()!, W, H).forEach(visit);
  return open;
}

/**
 * Join land pockets enclosed by raised water (shallows, islets) to the pool
 * at its level, so a high lake has no pits. Ground is never lowered.
 */
export function fillPoolHoles(pool: Uint8Array, heights: Float32Array, W: number, H: number): void {
  const open = openLand(pool, W, H);
  const queue: number[] = [];
  pool.forEach((p, i) => p && queue.push(i));
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    for (const j of neighbours4(i, W, H)) {
      if (pool[j] || open[j]) continue;
      pool[j] = 1;
      heights[j] = Math.max(heights[j], heights[i]);
      queue.push(j);
    }
  }
}

/**
 * Mark where each pool pours out: the pool pixels within `width` px of the
 * pool pixel nearest to each outlet point.
 */
export function markFalls(pool: Uint8Array, W: number, H: number, outlets: readonly Pixel[], width: number): Uint8Array {
  const falls = new Uint8Array(W * H);
  const centre = (i: number): Pixel => ({ x: (i % W) + 0.5, y: Math.floor(i / W) + 0.5 });
  const dist = (i: number, p: Pixel) => Math.hypot(centre(i).x - p.x, centre(i).y - p.y);
  const cells = [...pool.keys()].filter((i) => pool[i]);
  if (!cells.length) return falls;
  for (const p of outlets) {
    const lip = centre(cells.reduce((m, i) => (dist(i, p) < dist(m, p) ? i : m)));
    for (const i of cells) if (dist(i, lip) <= width) falls[i] = 1;
  }
  return falls;
}

/**
 * Churned water on the land at the foot of a waterfall: land pixels within
 * `radius` px of a falling pool pixel turn to foam over blue, fading outward.
 */
export function paintSplash(ground: Raster, pool: Uint8Array, falls: Uint8Array, radius: number): void {
  const { width: W, height: H } = ground;
  const near = new Float32Array(W * H).fill(Infinity);
  falls.forEach((f, i) => {
    if (!f) return;
    const [fx, fy] = [i % W, Math.floor(i / W)];
    for (let y = Math.max(0, fy - radius); y <= Math.min(H - 1, fy + radius); y++) {
      for (let x = Math.max(0, fx - radius); x <= Math.min(W - 1, fx + radius); x++) {
        const j = y * W + x;
        if (!pool[j]) near[j] = Math.min(near[j], Math.hypot(x - fx, y - fy));
      }
    }
  });
  near.forEach((d, j) => {
    if (d > radius) return;
    const [x, y] = [j % W, Math.floor(j / W)];
    const [r, g, b, a] = getPixel(ground, x, y);
    if (!a) return;
    const water = waterfallColor(x, y * 3, radius - d);
    setPixel(ground, x, y, mix([r, g, b], water, smoothstep(radius, radius * 0.4, d)), a);
  });
}

/**
 * Paint a stone lip along the edge of raised water (pool pixels standing
 * above ground within `width` px), so a high lake reads as a basin held
 * above the land; where it pours over (`falls`) the lip is foam instead.
 */
export function paintPoolRims(ground: Raster, heights: Float32Array, pool: Uint8Array, falls: Uint8Array, width: number): void {
  const { width: W, height: H } = ground;
  const atEdge = (x: number, y: number, h: number) => {
    for (let dy = -width; dy <= width; dy++) {
      for (let dx = -width; dx <= width; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && heights[ny * W + nx] < h - 1) return true;
      }
    }
    return false;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!pool[i] || !atEdge(x, y, heights[i])) continue;
      setPixel(ground, x, y, falls[i] ? FALL_FOAM : shade(LIP, 0.8 + 0.3 * valueNoise2D(x * 0.4, y * 0.4, 53)));
    }
  }
}
