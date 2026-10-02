import type { Pixel } from '../math/hex';
import { hash2 } from '../math/noise';
import { clamp, piecewise, smoothstep } from '../math/scalar';
import { mix, type RGB } from '../rendering/palette';
import { getPixel, setPixel, type Raster } from './raster';
import { CASCADE_DROP, rapidsFoam, riverStroke, smoothPath } from './rivers';

/**
 * Rivers painted onto the ground from the water model's river beds (per
 * hex: the bed, the water running through now, the hex it drains to). Each
 * river runs from where it springs down to the sea, a lake or the river it
 * joins, winding: it bends a little differently between every two hexes,
 * the same way every time. Its bed shows as stones and gravel, dry when no
 * water runs; the water fills it as the river runs, wider the more it
 * carries, over its banks in a flood, white where it drops steeply.
 */

/**
 * Hex chains, one per river: each from where it springs (the hex feeding its
 * first river hex, if any) through its river hexes (`isRiver`) down to the
 * hex it ends in. Rivers are followed from their largest sources down, and a
 * river ends where it joins one already drawn.
 */
export function riverPaths(down: Int32Array, bed: ArrayLike<number>, isRiver: (i: number) => boolean): number[][] {
  const n = down.length;
  const fed = new Uint8Array(n);
  const feeder = new Int32Array(n).fill(-1);
  for (let j = 0; j < n; j++) {
    const i = down[j];
    if (i < 0) continue;
    if (isRiver(j)) fed[i] = 1;
    else if (feeder[i] < 0 || bed[j] > bed[feeder[i]]) feeder[i] = j;
  }
  const heads = Array.from({ length: n }, (_, i) => i).filter((i) => isRiver(i) && !fed[i]);
  heads.sort((a, b) => bed[b] - bed[a]);
  const taken = new Uint8Array(n);
  const paths: number[][] = [];
  for (const head of heads) {
    const path = feeder[head] >= 0 ? [feeder[head]] : [];
    for (let i = head; i >= 0; i = down[i]) {
      path.push(i);
      if (taken[i] || !isRiver(i)) break;
      taken[i] = 1;
    }
    if (path.length >= 2) paths.push(path);
  }
  return paths;
}

/** How far a river strays from a hex's middle, and how far it bends out between two hexes, in hex radii. */
const STRAY = 0.22;
const BEND = 0.32;

/**
 * The winding line of a river through `cells`, smoothed, and how far along
 * it (0–1) each of its hexes lies. Where it passes a hex, and how it bends
 * between two, depends only on those hexes: rivers through the same hex meet.
 */
export function riverCurve(cells: readonly number[], centre: (i: number) => Pixel, size: number, seed: number): { points: Pixel[]; along: number[] } {
  const through = (i: number): Pixel => {
    const c = centre(i);
    return { x: c.x + (hash2(i, 1, seed) - 0.5) * 2 * STRAY * size, y: c.y + (hash2(i, 2, seed) - 0.5) * 2 * STRAY * size };
  };
  const bend = (a: number, b: number, p: Pixel, q: Pixel): Pixel => {
    const [dx, dy] = [q.x - p.x, q.y - p.y];
    const len = Math.hypot(dx, dy) || 1;
    const out = (hash2(Math.min(a, b), Math.max(a, b), seed + 3) - 0.5) * 2 * BEND * size * (a < b ? 1 : -1);
    return { x: (p.x + q.x) / 2 - (dy / len) * out, y: (p.y + q.y) / 2 + (dx / len) * out };
  };
  const control: Pixel[] = [];
  cells.forEach((i, k) => {
    const p = through(i);
    if (k > 0) control.push(bend(cells[k - 1], i, control[control.length - 1], p));
    control.push(p);
  });
  const lengths = control.map((p, k) => (k ? Math.hypot(p.x - control[k - 1].x, p.y - control[k - 1].y) : 0));
  const total = lengths.reduce((s, l) => s + l, 0) || 1;
  let done = 0;
  const along = lengths.map((l) => (done += l) / total).filter((_, k) => k % 2 === 0);
  return { points: smoothPath(control, 3), along };
}

/** What painting rivers needs to know, per hex and per pixel. */
export interface RiverPaint {
  centre: (i: number) => Pixel;
  size: number;
  seed: number;
  /** Per hex: the flow its bed was worn for, the water running through now, the ground's height (steps). */
  bed: ArrayLike<number>;
  flow: ArrayLike<number>;
  ground: ArrayLike<number>;
  /** Whether to leave pixel (x, y) as it is (open water). */
  keep: (x: number, y: number) => boolean;
  /** The water's own colour at a pixel. */
  water: (x: number, y: number) => RGB;
  /** The target is the map squashed vertically by this much (projected); 1 if absent. */
  squash?: number;
}

/** Width of a bed and of the water in it per square root of flow, and their bounds, in hex radii. */
const BED_WIDTH = { perRoot: 1.2, min: 0.16, max: 0.55 };
const WATER_WIDTH = { perRoot: 1.2, min: 0.06, max: 0.7 };
/** Below this the water is too little to show. */
const TRICKLE = 0.002;
const GRAVEL: RGB = [162, 152, 134];
const STONE: RGB = [112, 104, 92];
const DEEP: RGB = [24, 74, 120];
const FOAM: RGB = [240, 248, 255];
/** Reach of the white water where a river drops steeply, in hex radii. */
const RAPIDS_REACH = 0.8;

const widthOf = ({ perRoot, min, max }: typeof BED_WIDTH, flow: number) => clamp(perRoot * Math.sqrt(flow), min, max);

/** Paint `paths` onto `target`; returns which of its pixels the rivers' beds cover. */
export function paintRivers(target: Raster, paths: readonly number[][], ctx: RiverPaint): Uint8Array {
  const { width: W, height: H } = target;
  const squash = ctx.squash ?? 1;
  const mask = new Uint8Array(W * H);
  for (const cells of paths) {
    const { points, along } = riverCurve(cells, ctx.centre, ctx.size, ctx.seed);
    const byHex = (value: (i: number) => number) => piecewise(cells.map((i, k) => [along[k], value(i)] as [number, number]));
    const bedWidth = byHex((i) => widthOf(BED_WIDTH, ctx.bed[i]) * ctx.size);
    const flow = byHex((i) => ctx.flow[i]);
    const waterWidth = (t: number) => (flow(t) < TRICKLE ? 0 : widthOf(WATER_WIDTH, flow(t)) * ctx.size);
    const drops = cells
      .slice(1)
      .map((b, k) => [cells[k], b])
      .filter(([a, b]) => ctx.ground[a] - ctx.ground[b] >= CASCADE_DROP && ctx.flow[a] >= TRICKLE)
      .map(([a, b]) => {
        const [p, q] = [ctx.centre(a), ctx.centre(b)];
        return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      });
    for (const [i, centre] of riverStroke(points, W, H, bedWidth, squash)) {
      const [x, y] = [i % W, Math.floor(i / W)];
      if (ctx.keep(x, y)) continue;
      const [r, g, b] = getPixel(target, x, y);
      const pebbles = 0.82 + 0.36 * hash2(x >> 1, y >> 1, ctx.seed + 11);
      const stones = mix(GRAVEL, STONE, smoothstep(0.5, 0, centre)).map((v) => v * pebbles) as RGB;
      setPixel(target, x, y, mix([r, g, b], stones, smoothstep(0, 0.35, centre)));
      mask[i] = 1;
    }
    for (const [i, centre] of riverStroke(points, W, H, waterWidth, squash)) {
      const [x, y] = [i % W, Math.floor(i / W)];
      if (ctx.keep(x, y)) continue;
      const [r, g, b] = getPixel(target, x, y);
      const foam = Math.max(0, ...drops.map((at) => rapidsFoam(x, y / squash, at, RAPIDS_REACH * ctx.size)));
      const water = mix(mix(ctx.water(x, y), DEEP, 0.35 * centre), FOAM, foam * 0.8);
      setPixel(target, x, y, mix([r, g, b], water, smoothstep(0, 0.3, centre)));
      mask[i] = 1;
    }
  }
  return mask;
}
