import { clamp } from '../math/scalar';
import { MAX_ELEVATION } from './levels';

/**
 * High lakes on the flat map: standing water above the foothills keeps its
 * natural shape (from the map data) and is drawn lifted above the land by the
 * lake's height, walled in by the lake painter.
 */

/** Elevation (steps) from which standing water is a high lake, drawn lifted. */
export const HIGH_LAKE_FROM = 2.5;

/** How high a lake's water stands above the land, in hex radii: low on the foothills, about a hex high in the mountains. */
export function lakeLift(level: number): number {
  return 0.25 + 0.75 * clamp((level - HIGH_LAKE_FROM) / (MAX_ELEVATION - 1 - HIGH_LAKE_FROM), 0, 1);
}

/** One lake's water over a box of frame pixels. */
export interface LakeShape {
  /** Mean surface level of the water, in steps. */
  level: number;
  /** Highest surface level: an uneven lake is higher on one side. */
  top: number;
  x0: number;
  y0: number;
  width: number;
  height: number;
  /** Per box pixel: 1 water, 2 dry land the water surrounds (an island), 0 outside the lake. */
  mask: Uint8Array;
  /** Surface level per box pixel (on islands, the water's around them), NaN outside the lake. */
  levels: Float32Array;
  /** Water depth per box pixel, in steps (0 on islands, and without a ground map). */
  depth: Float32Array;
}

const neighbours4 = (i: number, W: number, H: number) =>
  [i % W > 0 ? i - 1 : -1, i % W < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < W * (H - 1) ? i + W : -1].filter((j) => j >= 0);

/** Mark (2) everything inside `mask` the box border cannot reach without crossing water: islands. */
function markIslands(mask: Uint8Array, W: number, H: number): void {
  const outside = new Uint8Array(W * H);
  const stack: number[] = [];
  const visit = (i: number) => {
    if (mask[i] || outside[i]) return;
    outside[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < W; x++) [x, (H - 1) * W + x].forEach(visit);
  for (let y = 0; y < H; y++) [y * W, y * W + W - 1].forEach(visit);
  while (stack.length) neighbours4(stack.pop()!, W, H).forEach(visit);
  mask.forEach((m, i) => (mask[i] = m || outside[i] ? m : 2));
}

/** Give every island pixel the level of the nearest water, spreading inward from the shore. */
function levelIslands(mask: Uint8Array, levels: Float32Array, W: number, H: number): void {
  if (!mask.includes(2)) return;
  let front = [...mask.keys()].filter((i) => mask[i] === 1);
  while (front.length) {
    const next: number[] = [];
    for (const i of front) {
      for (const j of neighbours4(i, W, H)) {
        if (mask[j] !== 2 || !Number.isNaN(levels[j])) continue;
        levels[j] = levels[i];
        next.push(j);
      }
    }
    front = next;
  }
}

/**
 * Each lake in a per-pixel map of water levels (NaN where dry), with the
 * land it surrounds; specks under `minArea` pixels are dropped. With the
 * ground's elevation per pixel, each shape also knows how deep its water is.
 */
export function lakeShapes(level: Float32Array, W: number, H: number, minArea = 0, ground?: Float32Array): LakeShape[] {
  const seen = new Uint8Array(W * H);
  const shapes: LakeShape[] = [];
  level.forEach((l, start) => {
    if (seen[start] || Number.isNaN(l)) return;
    const pixels = [start];
    seen[start] = 1;
    for (let q = 0; q < pixels.length; q++) {
      for (const j of neighbours4(pixels[q], W, H)) {
        if (seen[j] || Number.isNaN(level[j])) continue;
        seen[j] = 1;
        pixels.push(j);
      }
    }
    if (pixels.length < minArea) return;
    let [x0, y0, x1, y1, sum, top] = [W, H, 0, 0, 0, -Infinity]; // a loop, not Math.min(...): big lakes have too many pixels to spread
    for (const i of pixels) {
      const [x, y] = [i % W, Math.floor(i / W)];
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      [sum, top] = [sum + level[i], Math.max(top, level[i])];
    }
    const [width, height] = [x1 - x0 + 1, y1 - y0 + 1];
    const box = (i: number) => (Math.floor(i / W) - y0) * width + (i % W) - x0;
    const mask = new Uint8Array(width * height);
    const levels = new Float32Array(width * height).fill(NaN);
    const depth = new Float32Array(width * height);
    for (const i of pixels) [mask[box(i)], levels[box(i)], depth[box(i)]] = [1, level[i], ground ? Math.max(0, level[i] - ground[i]) : 0];
    markIslands(mask, width, height);
    levelIslands(mask, levels, width, height);
    shapes.push({ level: sum / pixels.length, top, x0, y0, width, height, mask, levels, depth });
  });
  return shapes;
}
