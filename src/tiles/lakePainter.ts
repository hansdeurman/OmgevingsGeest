import { valueNoise2D } from '../math/noise';
import { clamp, smoothstep } from '../math/scalar';
import { mix, shade, type RGB } from '../rendering/palette';
import { createRaster, sampleRaster, type Raster } from './raster';
import { lakeLift, type LakeShape } from './shores';
import { faceRow, sampleStrip, type WallStrip } from './wallStrip';
import { waterColour, waterWeights, waveCrest, type WaterTextures, type Wind } from './waterLook';

/**
 * A high lake as one image in scene pixels: the lake standing on its own
 * mountain. Every pixel of water stands at the height of its own level, so a
 * lake that has not levelled out yet slopes (with foam where it runs
 * downhill); land the water surrounds stands at the water's height; a stone
 * rim runs round it; and from the rim the land runs down to the floor all
 * round as a mountain flank, gradually, painted with the land itself and lit
 * by its slope, rock just under the rim. Where the lake pours out, a stream
 * runs down the flank. Drawn as a height field, row by row from the back.
 */

/** A lake's weather and outflow. */
export interface LakeState {
  /** 0 … 1: how hard the lake spills over its whole rim. */
  spill: number;
  /** 0 frozen … 1 warm. */
  temperature: number;
  wind: Wind;
  /** Where the lake pours out (frame px), while it does, and how much (steps of water per step). */
  outlet?: { x: number; y: number };
  outflow?: number;
}

/** The art one lake is painted with. */
export interface LakeArt {
  /** Rock: the band of the flank just under the rim. */
  wall: WallStrip;
  /** The rim's top, seen from above. */
  rim: Raster;
  /** The land under the water, on its islands and on its flank, in frame pixels. */
  floor?: Raster;
  water: WaterTextures;
}

/** What a painted lake puts where, per frame pixel of its box: how high (scene px, NaN outside) and what (water, island, land). */
export interface LakeSurface {
  x0: number;
  y0: number;
  width: number;
  height: number;
  lift: Float32Array;
  kind: Uint8Array;
  /** The water's level (steps) on water pixels, NaN elsewhere. */
  level: Float32Array;
}

/** The painted lake, where its top-left corner goes (scene px), and what it stands on. */
export interface LakeImage {
  raster: Raster;
  x: number;
  y: number;
  surface: LakeSurface;
}

/** What a lake's surface holds at a pixel: water, an island in it, or land (its rim and flank). */
export const WATER = 1;
export const ISLAND = 2;
export const LAND = 3;

/** Rim width, in hex radii. */
const RIM = 0.1;
/** The flank reaches out this many times the lake's height (px), and is rock for its first `rock` px. */
const FLANK = { reach: 1.8, rock: 4 };
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
/** A stream down the flank: its width (hex radii) per square root of outflow, and its least width. */
const STREAM = { perRootFlow: 0.5, min: 0.1 };
const FOAM: RGB = [236, 246, 250];

type RGBA = [number, number, number, number];

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

/** Distance in px from every pixel to the nearest set pixel of `mask`, and the `value` of that pixel (two-pass chamfer). */
export function nearest(mask: ArrayLike<number>, value: ArrayLike<number>, W: number, H: number) {
  const dist = Float32Array.from({ length: W * H }, (_, i) => (mask[i] ? 0 : Infinity));
  const from = Float32Array.from({ length: W * H }, (_, i) => (mask[i] ? value[i] : NaN));
  const relax = (i: number, j: number, step: number) => {
    if (dist[j] + step >= dist[i]) return;
    dist[i] = dist[j] + step;
    from[i] = from[j];
  };
  const sweep = (y: number, x: number, s: 1 | -1) => {
    const i = y * W + x;
    if (!dist[i]) return;
    if (x - s >= 0 && x - s < W) relax(i, i - s, 1);
    if (y - s < 0 || y - s >= H) return;
    relax(i, i - s * W, 1);
    if (x - 1 >= 0) relax(i, i - s * W - 1, Math.SQRT2);
    if (x + 1 < W) relax(i, i - s * W + 1, Math.SQRT2);
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) sweep(y, x, 1);
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) sweep(y, x, -1);
  return { dist, from };
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
  const at = (i: number, j: number) => (mask[j] === WATER ? levels[j] : levels[i]);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (mask[i] !== WATER) continue;
      slope[i] = Math.hypot((at(i, i + 1) - at(i, i - 1)) / 2, (at(i, i + W) - at(i, i - W)) / 2);
    }
  }
  return slope;
}

/** The middle of the shape's water (box px). */
function middleOf(mask: Uint8Array, W: number) {
  let [sx, sy, n] = [0, 0, 0];
  mask.forEach((m, i) => {
    if (m !== WATER) return;
    sx += i % W;
    sy += Math.floor(i / W);
    n++;
  });
  return { x: sx / Math.max(1, n), y: sy / Math.max(1, n) };
}

/**
 * Per pixel of the padded box: how high it stands (scene px) and what it is.
 * The lake at its level and its islands with it; the rim at the height of the
 * water beside it; then the flank, falling from the rim to the floor over a
 * reach in proportion to its height, steeper at the top, easing out below.
 */
function heightField(mask: Uint8Array, levels: Float32Array, W: number, H: number, rim: number, size: number) {
  const lakeLiftAt = Float32Array.from(levels, (l) => (Number.isNaN(l) ? 0 : lakeLift(l) * size));
  const { dist, from } = nearest(mask, lakeLiftAt, W, H);
  const lift = new Float32Array(W * H).fill(NaN);
  const kind = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (mask[i]) {
      lift[i] = lakeLiftAt[i];
      kind[i] = mask[i];
      continue;
    }
    const t = dist[i] < rim + 0.5 ? 0 : (dist[i] - rim) / Math.max(1, FLANK.reach * from[i]);
    if (t >= 1) continue;
    lift[i] = from[i] * (1 - t) ** 2;
    kind[i] = LAND;
  }
  return { lift, kind, dist };
}

export function paintLake(shape: LakeShape, state: LakeState, art: LakeArt, squash: number, size: number): LakeImage {
  const rim = Math.max(1, Math.round(RIM * size));
  const highest = lakeLift(shape.top) * size;
  const pad = rim + Math.ceil(FLANK.reach * highest) + 2;
  const { W, H, mask, levels, depth } = padded(shape, pad);
  const [bx, by] = [shape.x0 - pad, shape.y0 - pad];
  const slope = surfaceSlope(mask, levels, W, H);
  const { lift, kind, dist } = heightField(mask, levels, W, H, rim, size);
  // How far island land lies from the water (for its wet shore); only worth working out if there are islands.
  const toWater = mask.includes(ISLAND) ? nearest(mask.map((m) => (m === WATER ? 1 : 0)), lift, W, H).dist : undefined;
  const liftAt = (i: number) => (i >= 0 && i < W * H && !Number.isNaN(lift[i]) ? lift[i] : 0);

  const top = Math.floor(by * squash - highest) - 2;
  const rowOf = (y: number, h: number) => Math.round((by + y) * squash - h) - top;
  const raster = createRaster(W, rowOf(H, 0) + 2);

  const weights = waterWeights(state.temperature);
  const floorAt = (x: number, y: number) => sampleRaster(art.floor ?? art.rim, bx + x, by + y);
  const waterAt = (x: number, y: number): RGB => {
    const i = y * W + x;
    const [fx, fy] = [bx + x, by + y];
    const running = slope[i] > FLOW_FOAM[0] ? smoothstep(FLOW_FOAM[0], FLOW_FOAM[1], slope[i]) * (0.6 + 0.4 * valueNoise2D(fx / (0.15 * size), fy / (0.15 * size), 77)) : 0;
    const c = shade(waterColour(art.water, fx, fy, weights, Math.max(waveCrest(fx, fy, state.wind, size), running)), 1 - DEEP_SHADE * smoothstep(DEEP[0], DEEP[1], depth[i]));
    return art.floor ? mix(c, floorAt(x, y), FLOOR_SHOW * (1 - smoothstep(0, SHALLOW, depth[i]))) : c;
  };
  // The stream down the flank, along the line from the lake's middle out through its outlet.
  const middle = middleOf(mask, W);
  const outlet = state.outlet && { x: state.outlet.x - bx, y: state.outlet.y - by };
  const streamWidth = Math.max(STREAM.min, STREAM.perRootFlow * Math.sqrt(state.outflow ?? 0)) * size;
  const inStream = (x: number, y: number) => {
    if (!outlet) return 0;
    const [dx, dy] = [outlet.x - middle.x, outlet.y - middle.y];
    const len = Math.hypot(dx, dy) || 1;
    const [px, py] = [x - outlet.x, y - outlet.y];
    if ((px * dx + py * dy) / len < -rim) return 0;
    return 1 - smoothstep(streamWidth / 2, streamWidth / 2 + 1, Math.abs(px * dy - py * dx) / len);
  };
  const rockAt = (x: number, band: number): RGB => {
    const [r, g, b] = sampleStrip(art.wall, bx + x, faceRow(art.wall, Math.floor(band), FLANK.rock * 4));
    return [r, g, b];
  };
  const landAt = (x: number, y: number): RGB => {
    const i = y * W + x;
    if (dist[i] < rim + 0.5) {
      const c = shade(sampleRaster(art.rim, bx + x, by + y), 1.06);
      return state.spill > 0 ? mix(c, waterAt(x, y), 0.5 * state.spill) : c;
    }
    const steep = lift[i] - liftAt(i + W);
    const side = liftAt(i - 1) - liftAt(i + 1);
    const band = dist[i] - rim;
    const ground = band < FLANK.rock ? mix(floorAt(x, y), rockAt(x, band), 1 - band / FLANK.rock) : floorAt(x, y);
    const lit = shade(ground, clamp(1 + 0.06 * side - 0.05 * Math.max(0, steep - 1), 0.7, 1.15));
    const wet = Math.max(inStream(x, y), state.spill * (1 - smoothstep(0, FLANK.rock * 2, band)));
    return wet > 0 ? mix(lit, mix(waterAt(x, y), FOAM, clamp(steep / 4, 0, 0.6)), wet) : lit;
  };
  const islandAt = (x: number, y: number): RGB => {
    const c = floorAt(x, y);
    return toWater && toWater[y * W + x] <= SHORE ? shade(c, SHORE_SHADE) : c;
  };

  // Back to front, each pixel a column from its own height down to where the pixel in front of it stands.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (Number.isNaN(lift[i])) continue;
      const c = kind[i] === WATER ? waterAt(x, y) : kind[i] === ISLAND ? islandAt(x, y) : landAt(x, y);
      const [from, to] = [rowOf(y, lift[i]), rowOf(y + 1, liftAt(i + W))];
      for (let Y = from; Y <= Math.max(from, to - 1); Y++) put(raster, x, Y, [c[0], c[1], c[2], 255]);
    }
  }
  const level = Float32Array.from(levels, (l, i) => (mask[i] === WATER ? l : NaN));
  return { raster, x: bx, y: top, surface: { x0: bx, y0: by, width: W, height: H, lift, kind, level } };
}
