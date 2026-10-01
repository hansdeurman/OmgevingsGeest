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

/** Pool pixels within `r` of pixel (x, y) (box), and the highest of their heights. */
function poolAround(pool: Uint8Array, heights: Float32Array, W: number, H: number, x: number, y: number, r: number) {
  let count = 0;
  let top = 0;
  for (let ny = Math.max(0, y - r); ny <= Math.min(H - 1, y + r); ny++) {
    for (let nx = Math.max(0, x - r); nx <= Math.min(W - 1, x + r); nx++) {
      const j = ny * W + nx;
      if (!pool[j]) continue;
      count++;
      top = Math.max(top, heights[j]);
    }
  }
  return { count, top };
}

/** Connected pool regions (4-neighbours), as lists of pixel indices. */
function poolRegions(pool: Uint8Array, W: number, H: number): number[][] {
  const seen = new Uint8Array(pool.length);
  const regions: number[][] = [];
  pool.forEach((p, start) => {
    if (!p || seen[start]) return;
    const region = [start];
    seen[start] = 1;
    for (let q = 0; q < region.length; q++) {
      for (const j of neighbours4(region[q], W, H)) {
        if (pool[j] && !seen[j]) {
          seen[j] = 1;
          region.push(j);
        }
      }
    }
    regions.push(region);
  });
  return regions;
}

/**
 * Smooth a pool's ragged edge with a majority vote over a (2r+1)² box (new
 * pixels take the water level around them), then drop regions smaller than
 * `minArea` pixels back to the floor: specks and spikes would show as thin
 * slivers of cliff.
 */
export function tidyPool(pool: Uint8Array, heights: Float32Array, W: number, H: number, r: number, minArea: number): void {
  const half = ((2 * r + 1) ** 2) / 2;
  const before = pool.slice();
  const levels = heights.slice();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const { count, top } = poolAround(before, levels, W, H, x, y, r);
      const keep = count > half;
      if (keep && !before[i]) heights[i] = Math.max(heights[i], top);
      if (!keep && before[i]) heights[i] = 0;
      pool[i] = keep ? 1 : 0;
    }
  }
  for (const region of poolRegions(pool, W, H)) {
    if (region.length >= minArea) continue;
    for (const i of region) {
      pool[i] = 0;
      heights[i] = 0;
    }
  }
}

const pixelCentre =(i: number, W: number): Pixel => ({ x: (i % W) + 0.5, y: Math.floor(i / W) + 0.5 });
const poolCells = (pool: Uint8Array) => [...pool.keys()].filter((i) => pool[i]);

/** Where each pool pours out: the centre of its pixel nearest to each outlet point. */
export function fallLips(pool: Uint8Array, W: number, outlets: readonly Pixel[]): Pixel[] {
  const cells = poolCells(pool);
  if (!cells.length) return [];
  const dist = (i: number, p: Pixel) => Math.hypot(pixelCentre(i, W).x - p.x, pixelCentre(i, W).y - p.y);
  return outlets.map((p) => pixelCentre(cells.reduce((m, i) => (dist(i, p) < dist(m, p) ? i : m)), W));
}

/** The pool pixels within `width` px of each lip: they pour over as a waterfall. */
export function markFalls(pool: Uint8Array, W: number, H: number, lips: readonly Pixel[], width: number): Uint8Array {
  const falls = new Uint8Array(W * H);
  for (const lip of lips) {
    for (const i of poolCells(pool)) {
      const c = pixelCentre(i, W);
      if (Math.hypot(c.x - lip.x, c.y - lip.y) <= width) falls[i] = 1;
    }
  }
  return falls;
}

/** Strongest darkening of the ground at the foot of a pool's cliff. */
const FOOT_SHADOW = 0.6;

/**
 * Shadow on the ground at the foot of a raised pool: ground pixels up to
 * `reach` px in front of (below) a pool pixel darken, most right at the wall.
 */
export function shadePoolFoot(ground: Raster, pool: Uint8Array, reach: number): void {
  const { width: W, height: H } = ground;
  for (let x = 0; x < W; x++) {
    let since = Infinity; // rows since the last pool pixel in this column
    for (let y = 0; y < H; y++) {
      const i = y * W + x;
      if (pool[i]) {
        since = 0;
        continue;
      }
      since++;
      if (since > reach) continue;
      const [r, g, b, a] = getPixel(ground, x, y);
      if (a) setPixel(ground, x, y, shade([r, g, b], 1 - (1 - FOOT_SHADOW) * smoothstep(reach + 1, 1, since)), a);
    }
  }
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
