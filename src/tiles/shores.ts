import { hash2 } from '../math/noise';
import { clamp } from '../math/scalar';
import { MAX_ELEVATION } from './levels';
import type { PropKind } from './propRules';
import { blurHeights } from './relief';
import type { PropInstance } from './scatter';

/**
 * High lakes on the flat map: the water keeps its natural shape (from the
 * map data), lifted above the land by the lake's height, and every seam is
 * covered by painted pieces placed along its shore: banks in front whose
 * top lip meets the water (low, medium or high, by the lake's height), rocks
 * rising behind it, and at the outlet a waterfall of the same height with
 * spray at its foot. Pieces are only placed and scaled, never squashed.
 */

/** Elevation (steps) from which standing water is a high lake, drawn lifted. */
export const HIGH_LAKE_FROM = 2.5;

export type ShoreClass = 'low' | 'mid' | 'high';
type ShoreKind = Extract<PropKind, 'bankLow' | 'bankMid' | 'bankHigh' | 'backRock' | 'fallLow' | 'fallMid' | 'fallHigh' | 'spray'>;

/**
 * Share of each piece's height, from its top down to the front edge of its
 * top: where the water meets it. Measured from the art.
 */
export const LIP: Record<ShoreKind, number> = {
  bankLow: 0.3,
  bankMid: 0.17,
  bankHigh: 0.09,
  backRock: 0.3,
  fallLow: 0.3,
  fallMid: 0.25,
  fallHigh: 0.12,
  spray: 0,
};
/** Height per width of each class's banks, from the art: low blocks, medium walls, tall pillars. */
const ASPECT: Record<ShoreClass, number> = { low: 0.6, mid: 0.6, high: 1.6 };
const BANK: Record<ShoreClass, ShoreKind> = { low: 'bankLow', mid: 'bankMid', high: 'bankHigh' };
const FALL: Record<ShoreClass, ShoreKind> = { low: 'fallLow', mid: 'fallMid', high: 'fallHigh' };
/** Banks overlap their neighbours by this share of their width: tall narrow pillars need more to close up. */
const OVERLAP: Record<ShoreClass, number> = { low: 0.45, mid: 0.45, high: 0.6 };
/** Height of the far-shore rocks, which stand on the lifted rim, and how far a bank stands out over the water, in hex radii. */
const RIM_ROCK = 0.4;
const REACH = 0.15;
/** Shore samples whose normal points this far toward the viewer face the front and get a bank; the rest get far-shore rocks. */
const FACING = 0.3;
/** How far in front of a shore to look for more of the same lake, in hex radii. */
const LOOK_AHEAD = 1.5;

/** Whether frame pixel (x, y) is water of this lake. */
const inLake = (shape: LakeShape, x: number, y: number) => {
  const [lx, ly] = [Math.floor(x - shape.x0), Math.floor(y - shape.y0)];
  return lx >= 0 && ly >= 0 && lx < shape.width && ly < shape.height && shape.mask[ly * shape.width + lx] === 1;
};
/** Size of the spray at a waterfall's foot, in hex radii. */
const SPRAY = 0.45;

/** How high a lake's water stands above the land, in hex radii: low on the foothills, about a hex high in the mountains. */
export function lakeLift(level: number): number {
  return 0.25 + 0.75 * clamp((level - HIGH_LAKE_FROM) / (MAX_ELEVATION - 1 - HIGH_LAKE_FROM), 0, 1);
}

export const shoreClass = (lift: number): ShoreClass => (lift < 0.45 ? 'low' : lift < 0.75 ? 'mid' : 'high');

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

/** A point on a shore (frame pixels) with its outward normal. */
export interface ShoreSample {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

/** Points along a lake's shore, at least `spacing` px apart, each with the normal pointing away from the water. */
export function shoreSamples(shape: LakeShape, spacing: number): ShoreSample[] {
  const r = Math.max(2, Math.round(spacing / 2));
  const [W, H] = [shape.width + 2 * r, shape.height + 2 * r];
  const soft = new Float32Array(W * H);
  shape.mask.forEach((m, i) => (soft[(Math.floor(i / shape.width) + r) * W + (i % shape.width) + r] = m));
  const hard = soft.slice();
  blurHeights(soft, W, H, r);
  const samples: ShoreSample[] = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!hard[i] || neighbours4(i, W, H).every((j) => hard[j])) continue; // only the water's edge
      const [px, py] = [shape.x0 + x - r + 0.5, shape.y0 + y - r + 0.5];
      if (samples.some((s) => Math.hypot(s.x - px, s.y - py) < spacing)) continue;
      const [gx, gy] = [soft[i + 1] - soft[i - 1], soft[i + W] - soft[i - W]];
      const g = Math.hypot(gx, gy) || 1;
      samples.push({ x: px, y: py, nx: -gx / g, ny: -gy / g });
    }
  }
  return samples;
}

/**
 * The pieces around one lake, in frame pixels on the ground: near-shore banks
 * (drawn after the water) standing on the land, and far-shore rocks (drawn
 * before it) that stand on the lifted rim: draw those `lift` pixels higher.
 */
export function shoreProps(shape: LakeShape, size: number, seed: number, outlet?: { x: number; y: number }) {
  const lift = lakeLift(shape.level) * size;
  const cls = shoreClass(lakeLift(shape.level));
  const fit = (kind: ShoreKind) => lift / (1 - LIP[kind]); // drawn height so the lip sits at the water
  const bankHeight = fit(BANK[cls]);
  const rockHeight = RIM_ROCK * size;
  const spaced = (height: number, aspect: number, overlap: number) => shoreSamples(shape, (height / aspect) * (1 - overlap));
  const piece = (kind: ShoreKind, x: number, y: number, height: number, k: number, flip = false): PropInstance => ({
    kind,
    variant: Math.floor(hash2(k, Math.round(shape.level * 10), seed) * 1000),
    x,
    y,
    col: -1,
    row: -1,
    height,
    flip,
  });

  // A bank needs lower land in front of it: on a strip between two arms of the lake the water is level on both sides.
  const wetAhead = (q: ShoreSample) => {
    for (let d = 2; d <= LOOK_AHEAD * size; d++) if (inLake(shape, q.x + q.nx * d, q.y + q.ny * d)) return true;
    return false;
  };
  const near = spaced(bankHeight, ASPECT[cls], OVERLAP[cls]).filter((s) => s.ny > FACING && !wetAhead(s));
  // The bank nearest the outlet that faces it; none when the lake pours away from the viewer (hidden behind it).
  const away = (q: ShoreSample) => (outlet ? Math.hypot(outlet.x - q.x, outlet.y - q.y) : Infinity);
  const facing = (q: ShoreSample) => !!outlet && q.nx * (outlet.x - q.x) + q.ny * (outlet.y - q.y) > 0.5 * away(q);
  const spills = near.filter(facing).reduce<ShoreSample | undefined>((a, b) => (!a || away(b) < away(a) ? b : a), undefined);

  const front = near.flatMap((s, k) => {
    const [x, y] = [s.x + s.nx * REACH * size, s.y + s.ny * REACH * size];
    if (s !== spills) return [piece(BANK[cls], x, y, bankHeight, k, hash2(k, 7, seed) < 0.5)];
    const fall = piece(FALL[cls], x, y, fit(FALL[cls]), k, s.nx < 0);
    return [fall, piece('spray', x + s.nx * SPRAY * 0.5 * size, y + s.ny * SPRAY * 0.5 * size, SPRAY * size, k)];
  });
  const back = spaced(rockHeight, ASPECT.low, OVERLAP.low)
    .filter((s) => s.ny <= FACING)
    .map((s, k) => piece('backRock', s.x, s.y, rockHeight, k + 1000, hash2(k, 9, seed) < 0.5));
  const byDepth = (a: PropInstance, b: PropInstance) => a.y - b.y;
  return { back: back.sort(byDepth), front: front.sort(byDepth), lift };
}
