import { clamp, smoothstep } from '../math/scalar';
import { mix, shade, type RGB } from '../rendering/palette';
import { createRaster, sampleRaster, type Raster } from './raster';
import { blurHeights } from './relief';
import type { LakeShape } from './shores';
import { faceRow, sampleStrip, wallRow, type WallStrip } from './wallStrip';
import { waterColour, waterWeights, waveCrest, type WaterTextures, type Wind } from './waterLook';

/**
 * A high lake as one image in scene pixels, painted from the back row by row
 * so nearer parts cover farther ones: a stone rim at the height of the land
 * the lake lies in, the water at its own level, the basin's far wall wherever
 * the water stands below the rim, and along the near shore the outer wall
 * from the rim down to the floor. Every height comes from the lake's state,
 * so small changes in water level show as more or less wall.
 */

/** One lake as the simulation sees it; heights in scene px above the floor. */
export interface LakeState {
  /** The land around the lake: the top of its walls. */
  rim: number;
  /** The water's surface; at most the rim. */
  water: number;
  /** 0 … 1: how hard the lake spills over its near rim. */
  spill: number;
  /** 0 frozen … 1 warm. */
  temperature: number;
  wind: Wind;
  /** Where the lake pours out (frame px): a waterfall runs down the near wall there while the lake is full. */
  outlet?: { x: number; y: number };
}

/** The art one lake is painted with. */
export interface LakeArt {
  wall: WallStrip;
  /** The near wall while the lake spills over it. */
  spillWall?: WallStrip;
  /** A waterfall down a wall, its stream down the middle. */
  outfall?: WallStrip;
  /** The rim's top, seen from above. */
  rim: Raster;
  water: WaterTextures;
}

/** The painted lake and where its top-left corner goes, in scene px. */
export interface LakeImage {
  raster: Raster;
  x: number;
  y: number;
}

type RGBA = [number, number, number, number];

/** Rim width, the wet band above the water, the shadow in front of the wall and the depth of the darkest water, in hex radii. */
const RIM = 0.1;
const WET = 0.07;
const FOOT_SHADOW = 0.12;
const DEPTH = 0.3;
/** The basin's far wall lies in its own shade, darker still where it was wet. */
const INNER_SHADE = 0.78;
const WET_SHADE = 0.62;
const ALGAE: RGB = [72, 104, 46];
/** How much darker the middle of a lake is than its shallows. */
const DEEP_SHADE = 0.2;
const SHADOW: RGBA = [24, 32, 24, 0.3 * 255];
/** Share of the waterfall art's width that shows, and how far in front of the near wall's foot an outlet may lie, in hex radii. */
const FALL_WIDTH = 0.45;
const FALL_REACH = 0.6;
/** A waterfall needs the wall this many px to either side to hang from (about) the same row. */
const FALL_STRAIGHT = 3;

/** Distance in px from every pixel to the nearest set pixel of `mask` (two-pass chamfer). */
export function distanceTo(mask: Uint8Array, W: number, H: number): Float32Array {
  const d = Float32Array.from(mask, (m) => (m ? 0 : Infinity));
  const relax = (i: number, j: number, step: number) => {
    if (d[j] + step < d[i]) d[i] = d[j] + step;
  };
  const sweep = (y: number, x: number, s: 1 | -1) => {
    const i = y * W + x;
    if (!d[i]) return;
    if (x - s >= 0 && x - s < W) relax(i, i - s, 1);
    if (y - s < 0 || y - s >= H) return;
    relax(i, i - s * W, 1);
    if (x - 1 >= 0) relax(i, i - s * W - 1, Math.SQRT2);
    if (x + 1 < W) relax(i, i - s * W + 1, Math.SQRT2);
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) sweep(y, x, 1);
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) sweep(y, x, -1);
  return d;
}

/** Paint `c` over what is already at (x, y). */
function put(r: Raster, x: number, y: number, [cr, cg, cb, ca]: RGBA): void {
  if (x < 0 || y < 0 || x >= r.width || y >= r.height || ca <= 0) return;
  const i = (y * r.width + x) * 4;
  const [a, under] = [ca / 255, r.data[i + 3] / 255];
  const keep = under * (1 - a);
  const out = a + keep;
  r.data[i] = (cr * a + r.data[i] * keep) / out;
  r.data[i + 1] = (cg * a + r.data[i + 1] * keep) / out;
  r.data[i + 2] = (cb * a + r.data[i + 2] * keep) / out;
  r.data[i + 3] = out * 255;
}

const opaque = (c: RGB, a = 255): RGBA => [c[0], c[1], c[2], a];
const darker = ([r, g, b, a]: RGBA, k: number): RGBA => [r * k, g * k, b * k, a];

/**
 * Where on the near wall (box px: column and the row it hangs from) the lake
 * pours out: the straight stretch of wall nearest its outlet, if the outlet
 * lies on the near side. A waterfall on a bend would smear along it.
 */
function fallSpot(inside: (x: number, y: number) => boolean, W: number, H: number, outlet: { x: number; y: number }, size: number) {
  const foot = Array.from({ length: W }, (_, x) => {
    let y = H - 1;
    while (y >= 0 && !inside(x, y)) y--;
    return y;
  });
  const straight = (x: number) => [-FALL_STRAIGHT, FALL_STRAIGHT].every((d) => foot[x + d] >= 0 && Math.abs(foot[x + d] - foot[x]) <= 2);
  const spots = foot.map((y, x) => ({ x, y })).filter(({ x, y }) => y >= 0 && straight(x));
  const near = spots.reduce<{ x: number; y: number } | undefined>(
    (a, b) => (!a || Math.hypot(b.x - outlet.x, b.y - outlet.y) < Math.hypot(a.x - outlet.x, a.y - outlet.y) ? b : a),
    undefined,
  );
  return near && outlet.y >= near.y - FALL_REACH * size ? near : undefined;
}

export function paintLake(shape: LakeShape, state: LakeState, art: LakeArt, squash: number, size: number): LakeImage {
  const r = Math.max(1, Math.round(RIM * size));
  const pad = r + 1;
  const [W, H] = [shape.width + 2 * pad, shape.height + 2 * pad];
  const [bx, by] = [shape.x0 - pad, shape.y0 - pad];
  const water = new Uint8Array(W * H);
  shape.mask.forEach((m, i) => (water[(Math.floor(i / shape.width) + pad) * W + (i % shape.width) + pad] = m));
  const dist = distanceTo(water, W, H);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && dist[y * W + x] < r + 0.5;
  const deep = Float32Array.from(water);
  blurHeights(deep, W, H, Math.max(1, Math.round(DEPTH * size)));

  const { rim } = state;
  const level = Math.min(state.water, rim);
  const wall = state.spill > 0 && art.spillWall ? art.spillWall : art.wall;
  const cap = wall.lip;
  const top = Math.floor(by * squash - rim - cap) - 1;
  const rowOf = (y: number, h: number) => Math.round((by + y) * squash - h) - top;
  const shadow = Math.round(FOOT_SHADOW * size);
  const raster = createRaster(W, rowOf(H - 1, 0) + shadow + 2);

  const weights = waterWeights(state.temperature);
  const algae = 0.5 * smoothstep(0.6, 1, state.temperature);
  const waterAt = (x: number, y: number): RGB => {
    const [fx, fy] = [bx + x, by + y];
    const c = waterColour(art.water, fx, fy, weights, waveCrest(fx, fy, state.wind, size));
    return shade(c, 1 - DEEP_SHADE * smoothstep(0.5, 0.95, deep[y * W + x]));
  };
  const rimAt = (x: number, y: number): RGB => {
    const c = shade(sampleRaster(art.rim, bx + x, by + y), 1.06);
    return state.spill > 0 ? mix(c, waterAt(x, y), 0.5 * state.spill) : c;
  };
  const outfall = art.outfall;
  const fall = outfall && state.outlet && level >= rim - 0.5 ? fallSpot(inside, W, H, { x: state.outlet.x - bx, y: state.outlet.y - by }, size) : undefined;
  const withFall = (c: RGBA, x: number, y: number, v: number, face: number): RGBA => {
    if (!fall || !outfall || Math.abs(y - fall.y) > FALL_STRAIGHT) return c;
    const half = (FALL_WIDTH * outfall.image.width) / 2;
    const dx = Math.abs(x - fall.x);
    if (dx >= half) return c;
    const f = sampleStrip(outfall, outfall.image.width / 2 + x - fall.x, wallRow(outfall, v, face, cap));
    const k = (1 - smoothstep(0.5, 1, dx / half)) * (f[3] / 255);
    return [c[0] + (f[0] - c[0]) * k, c[1] + (f[1] - c[1]) * k, c[2] + (f[2] - c[2]) * k, Math.max(c[3], f[3] * k)];
  };

  for (let y = 0; y < H; y++) {
    // The basin's far wall, from the rim down to the water.
    for (let x = 0; x < W; x++) {
      if (!water[y * W + x] || water[(y - 1) * W + x]) continue;
      const [from, to, face] = [rowOf(y, rim), rowOf(y, level), rowOf(y, 0) - rowOf(y, rim) + 1];
      for (let Y = from; Y < to; Y++) {
        const c = sampleStrip(art.wall, bx + x, faceRow(art.wall, Y - from, face));
        const wet = to - Y <= Math.round(WET * size);
        put(raster, x, Y, wet ? opaque(mix(shade([c[0], c[1], c[2]], WET_SHADE), ALGAE, algae), c[3]) : darker(c, INNER_SHADE));
      }
    }
    // The water at its level, the rim at the land's.
    for (let x = 0; x < W; x++) {
      if (!inside(x, y)) continue;
      const d = dist[y * W + x];
      if (d === 0) put(raster, x, rowOf(y, level), opaque(waterAt(x, y)));
      else put(raster, x, rowOf(y, rim), opaque(rimAt(x, y), clamp(r + 0.5 - d, 0, 1) * 255));
    }
    // The near wall, capstone on top, from the rim to the floor, and its shadow in front.
    for (let x = 0; x < W; x++) {
      if (!inside(x, y) || inside(x, y + 1)) continue;
      const [from, foot] = [rowOf(y, rim) - cap, rowOf(y, 0)];
      const face = foot - rowOf(y, rim) + 1;
      for (let Y = from; Y <= foot; Y++) put(raster, x, Y, withFall(sampleStrip(wall, bx + x, wallRow(wall, Y - from, face)), x, y, Y - from, face));
      for (let k = 1; k <= shadow; k++) put(raster, x, foot + k, [SHADOW[0], SHADOW[1], SHADOW[2], SHADOW[3] * (1 - k / (shadow + 1))]);
    }
  }
  return { raster, x: bx, y: top };
}
