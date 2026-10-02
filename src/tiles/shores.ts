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

/** One lake's water as a mask over a box of frame pixels. */
export interface LakeShape {
  level: number;
  x0: number;
  y0: number;
  width: number;
  height: number;
  mask: Uint8Array;
}

const neighbours4 = (i: number, W: number, H: number) =>
  [i % W > 0 ? i - 1 : -1, i % W < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < W * (H - 1) ? i + W : -1].filter((j) => j >= 0);

/** Mark everything inside `mask` that the box border cannot reach without crossing water: islands and shallows. */
function fillHoles(mask: Uint8Array, W: number, H: number): void {
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
  mask.forEach((m, i) => (mask[i] = m || outside[i] ? m : 1));
}

/** Each high lake in a per-pixel map of lake levels (NaN where there is none), as a hole-free mask; specks under `minArea` pixels are dropped. */
export function lakeShapes(level: Float32Array, W: number, H: number, minArea = 0): LakeShape[] {
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
    let [x0, y0, x1, y1] = [W, H, 0, 0]; // a loop, not Math.min(...): big lakes have too many pixels to spread
    for (const i of pixels) {
      const [x, y] = [i % W, Math.floor(i / W)];
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    }
    const [width, height] = [x1 - x0 + 1, y1 - y0 + 1];
    const mask = new Uint8Array(width * height);
    for (const i of pixels) mask[(Math.floor(i / W) - y0) * width + (i % W) - x0] = 1;
    fillHoles(mask, width, height);
    shapes.push({ level: l, x0, y0, width, height, mask });
  });
  return shapes;
}
