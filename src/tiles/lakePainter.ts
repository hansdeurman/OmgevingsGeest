import { valueNoise2D } from '../math/noise';
import { clamp, smoothstep } from '../math/scalar';
import { mix, shade, type RGB } from '../rendering/palette';
import { createRaster, sampleRaster, type Raster } from './raster';
import { lakeLift, type LakeShape } from './shores';
import { sampleStrip, wallRow, type WallStrip } from './wallStrip';
import { waterColour, waterWeights, waveCrest, type WaterTextures, type Wind } from './waterLook';

/**
 * A high lake as one image in scene pixels, painted from the back row by row
 * so nearer parts cover farther ones. Every pixel of water stands at the
 * height of its own level, so a lake that has not levelled out yet slopes
 * (with foam where it runs downhill); land the water surrounds is shown at
 * the water's height; a stone rim runs round it and along the near shore a
 * wall drops from the rim to the floor. Through shallow water the floor
 * shows, deep water is darker: how deep it is, not only how high.
 */

/** A lake's weather and outflow. */
export interface LakeState {
  /** 0 … 1: how hard the lake spills over its near rim. */
  spill: number;
  /** 0 frozen … 1 warm. */
  temperature: number;
  wind: Wind;
  /** Where the lake pours out (frame px), while it does: a waterfall runs down the near wall there. */
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
  /** The land under the water and on its islands, in frame pixels. */
  floor?: Raster;
  water: WaterTextures;
}

/** The painted lake and where its top-left corner goes, in scene px. */
export interface LakeImage {
  raster: Raster;
  x: number;
  y: number;
}

type RGBA = [number, number, number, number];

/** Rim width and the shadow in front of the wall, in hex radii. */
const RIM = 0.1;
const FOOT_SHADOW = 0.12;
/** Water depth (steps) over which the lake darkens, and how much. */
const DEEP: [number, number] = [0.2, 1.6];
const DEEP_SHADE = 0.22;
/** Water shallower than this (steps) lets the floor show through, at most this much of it. */
const SHALLOW = 0.5;
const FLOOR_SHOW = 0.6;
/** Land at the waterline is wet: darker within this many px of the water. */
const SHORE = 1.5;
const SHORE_SHADE = 0.82;
/** Slope of the surface (steps per px) from which water visibly runs downhill, and at which it foams fully. */
const FLOW_FOAM: [number, number] = [0.004, 0.03];
const SHADOW: RGBA = [24, 32, 24, 0.3 * 255];
/** Share of the waterfall art's width that shows, and how far in front of the near wall's foot an outlet may lie, in hex radii. */
const FALL_WIDTH = 0.45;
const FALL_REACH = 0.6;
/** A waterfall needs the wall this many px to either side to hang from (about) the same row. */
const FALL_STRAIGHT = 3;

/** Distance in px from every pixel to the nearest set pixel of `mask` (two-pass chamfer). */
export function distanceTo(mask: ArrayLike<number>, W: number, H: number): Float32Array {
  const d = Float32Array.from({ length: W * H }, (_, i) => (mask[i] ? 0 : Infinity));
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

/** The shape's box grown by `pad` px on every side, its per-pixel data copied in. */
function padded(shape: LakeShape, pad: number) {
  const [W, H] = [shape.width + 2 * pad, shape.height + 2 * pad];
  const [mask, levels, depth] = [new Uint8Array(W * H), new Float32Array(W * H).fill(NaN), new Float32Array(W * H)];
  shape.mask.forEach((m, i) => {
    const j = (Math.floor(i / shape.width) + pad) * W + (i % shape.width) + pad;
    [mask[j], levels[j], depth[j]] = [m, shape.levels[i], shape.depth[i]];
  });
  return { W, H, mask, levels, depth };
}

/** Steepness of the water surface per pixel, in steps per px; 0 off the water. */
function surfaceSlope(mask: Uint8Array, levels: Float32Array, W: number, H: number): Float32Array {
  const slope = new Float32Array(W * H);
  const at = (i: number, j: number) => (mask[j] === 1 ? levels[j] : levels[i]);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (mask[i] !== 1) continue;
      slope[i] = Math.hypot((at(i, i + 1) - at(i, i - 1)) / 2, (at(i, i + W) - at(i, i - W)) / 2);
    }
  }
  return slope;
}

export function paintLake(shape: LakeShape, state: LakeState, art: LakeArt, squash: number, size: number): LakeImage {
  const r = Math.max(1, Math.round(RIM * size));
  const pad = r + 1;
  const { W, H, mask, levels, depth } = padded(shape, pad);
  const [bx, by] = [shape.x0 - pad, shape.y0 - pad];
  const dist = distanceTo(mask, W, H);
  const toWater = distanceTo(mask.map((m) => (m === 1 ? 1 : 0)), W, H);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && dist[y * W + x] < r + 0.5;
  const slope = surfaceSlope(mask, levels, W, H);

  // How high each pixel stands: the lake at its level, the rim at the lake's beside it.
  const lift = Float32Array.from(levels, (l) => (Number.isNaN(l) ? 0 : lakeLift(l) * size));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (mask[y * W + x] || !inside(x, y)) continue;
      let sum = 0;
      let n = 0;
      for (let dy = -pad; dy <= pad; dy++) {
        for (let dx = -pad; dx <= pad; dx++) {
          const j = (y + dy) * W + x + dx;
          if (x + dx < 0 || x + dx >= W || y + dy < 0 || y + dy >= H || !mask[j]) continue;
          sum += lift[j];
          n++;
        }
      }
      lift[y * W + x] = n ? sum / n : 0;
    }
  }

  const wall = state.spill > 0 && art.spillWall ? art.spillWall : art.wall;
  const cap = wall.lip;
  const top = Math.floor(by * squash - lift.reduce((a, b) => Math.max(a, b), 0) - cap) - 1;
  const rowOf = (y: number, h: number) => Math.round((by + y) * squash - h) - top;
  const shadow = Math.round(FOOT_SHADOW * size);
  const raster = createRaster(W, rowOf(H - 1, 0) + shadow + 2);

  const weights = waterWeights(state.temperature);
  const floorAt = (fx: number, fy: number) => sampleRaster(art.floor ?? art.rim, fx, fy);
  const waterAt = (x: number, y: number): RGB => {
    const i = y * W + x;
    const [fx, fy] = [bx + x, by + y];
    const running = slope[i] > FLOW_FOAM[0] ? smoothstep(FLOW_FOAM[0], FLOW_FOAM[1], slope[i]) * (0.6 + 0.4 * valueNoise2D(fx / (0.15 * size), fy / (0.15 * size), 77)) : 0;
    const c = shade(waterColour(art.water, fx, fy, weights, Math.max(waveCrest(fx, fy, state.wind, size), running)), 1 - DEEP_SHADE * smoothstep(DEEP[0], DEEP[1], depth[i]));
    return art.floor ? mix(c, floorAt(fx, fy), FLOOR_SHOW * (1 - smoothstep(0, SHALLOW, depth[i]))) : c;
  };
  const islandAt = (x: number, y: number): RGB => {
    const c = floorAt(bx + x, by + y);
    return toWater[y * W + x] <= SHORE ? shade(c, SHORE_SHADE) : c;
  };
  const rimAt = (x: number, y: number): RGB => {
    const c = shade(sampleRaster(art.rim, bx + x, by + y), 1.06);
    return state.spill > 0 ? mix(c, waterAt(x, y), 0.5 * state.spill) : c;
  };
  const outfall = art.outfall;
  const fall = outfall && state.outlet ? fallSpot(inside, W, H, { x: state.outlet.x - bx, y: state.outlet.y - by }, size) : undefined;
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
    // The water and its islands at their level, the rim beside them.
    for (let x = 0; x < W; x++) {
      if (!inside(x, y)) continue;
      const i = y * W + x;
      const Y = rowOf(y, lift[i]);
      if (mask[i] === 1) put(raster, x, Y, opaque(waterAt(x, y)));
      else if (mask[i] === 2) put(raster, x, Y, opaque(islandAt(x, y)));
      else put(raster, x, Y, opaque(rimAt(x, y), clamp(r + 0.5 - dist[i], 0, 1) * 255));
    }
    // The near wall, capstone on top, from the rim to the floor, and its shadow in front.
    for (let x = 0; x < W; x++) {
      if (!inside(x, y) || inside(x, y + 1)) continue;
      const [from, foot] = [rowOf(y, lift[y * W + x]) - cap, rowOf(y, 0)];
      const face = foot - from - cap + 1;
      for (let Y = from; Y <= foot; Y++) put(raster, x, Y, withFall(sampleStrip(wall, bx + x, wallRow(wall, Y - from, face)), x, y, Y - from, face));
      for (let k = 1; k <= shadow; k++) put(raster, x, foot + k, [SHADOW[0], SHADOW[1], SHADOW[2], SHADOW[3] * (1 - k / (shadow + 1))]);
    }
  }
  return { raster, x: bx, y: top };
}
