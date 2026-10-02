import { tileableValueNoise2D, hash2 } from '../math/noise';
import { clamp, piecewise, smoothstep } from '../math/scalar';
import type { RGB } from '../rendering/palette';
import { WETNESS } from '../water/wetness';
import { sampleField, type HexBlend } from './hexField';
import type { Raster } from './raster';

/**
 * The ground's look by how wet it is (the WETNESS scale), painted over the
 * map's ground of normal wetness:
 * - parched: grass burnt to straw, bare ground bleached and cracked;
 * - dry: grass yellowing, ground pale;
 * - normal: the ground as painted;
 * - moist: darker, richer ground, a puddle in the lowest spots;
 * - soaked: dark ground, water pooling all over it;
 * - flooded: under water, shallow enough to show the ground, darker deeper.
 * Between the stages the look changes gradually. Snow keeps its look.
 */

/** How strongly each change shows per stage. */
const LOOK = {
  straw: piecewise([[0, 0.85], [1, 0.45], [2, 0]]),
  cracks: piecewise([[0, 1], [0.8, 0]]),
  light: piecewise([[0, 1.14], [1, 1.07], [2, 1], [3, 0.8], [4, 0.72], [5, 0.7]]),
  saturation: piecewise([[0, -0.25], [1, -0.12], [2, 0], [3, 0.25], [4, 0.3], [5, 0]]),
  /** Share of the ground under water (by its puddle spots, lowest first). */
  puddles: piecewise([[2.4, 0], [3, 0.03], [4, 0.45], [4.85, 0.8], [5, 1.05]]),
  /** How much of the water's colour shows over the ground beneath. */
  water: piecewise([[3, 0.8], [4, 0.82], [5, 0.62], [6, 0.95]]),
  deep: piecewise([[5, 0], [6, 1]]),
};
type Look = keyof typeof LOOK;

/** The looks tabled per 1/RES of a stage, so a pixel only looks them up. */
const RES = 64;
const table = (look: Look) => Float32Array.from({ length: WETNESS.deep * RES + 1 }, (_, s) => LOOK[look](s / RES));
const [STRAW, CRACKS, LIGHT, SATURATION, PUDDLES, SHOWN, DEEPNESS] = (['straw', 'cracks', 'light', 'saturation', 'puddles', 'water', 'deep'] as const).map(table);
const stageIndex = (stage: number) => Math.round(clamp(stage, 0, WETNESS.deep) * RES);

const DEEP: RGB = [22, 70, 110];
/** Puddles are muddy, not clear. */
const MUD: RGB = [74, 68, 52];
const unit = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Grade one texel (r0, g0, b0) for the stage at table index `s`, into `out`
 * at `o`. `puddle` (0–1) says how low the spot lies (low spots fill first),
 * `crack` (0–1) whether a crack runs there; `water(x, y)` is the water's own
 * colour, asked only where water shows. Plain numbers only: it runs per pixel.
 */
function gradeInto(out: Uint8ClampedArray, o: number, r0: number, g0: number, b0: number, s: number, puddle: number, crack: number, water: (x: number, y: number) => RGB, x: number, y: number): void {
  let r = r0;
  let g = g0;
  let b = b0;
  const lum = 0.3 * r0 + 0.59 * g0 + 0.11 * b0;
  const green = unit((g0 - Math.max(r0, b0)) / 50);
  // Grass burns to straw; the ground pales in a drought and darkens when wet.
  const straw = STRAW[s] * green;
  if (straw > 0) {
    r += (lum * 1.08 + 38 - r) * straw;
    g += (lum * 0.95 + 22 - g) * straw;
    b += (lum * 0.45 + 5 - b) * straw;
  }
  const light = LIGHT[s];
  const sat = 1 + SATURATION[s];
  const l = (0.3 * r + 0.59 * g + 0.11 * b) * light;
  r = l + (r * light - l) * sat;
  g = l + (g * light - l) * sat;
  b = l + (b * light - l) * sat;
  // Cracks in bare, warm ground (soil, sand), not in grass or grey rock.
  if (CRACKS[s] > 0 && crack > 0) {
    const k = 1 - 0.45 * CRACKS[s] * crack * unit((r - b) / 60) * (1 - green);
    r *= k;
    g *= k;
    b *= k;
  }
  // Snow and ice keep their look.
  if (lum > 200) {
    const snow = smoothstep(200, 230, lum);
    r += (r0 - r) * snow;
    g += (g0 - g) * snow;
    b += (b0 - b) * snow;
  }
  const share = PUDDLES[s];
  if (share > 0) {
    const pooled = smoothstep(share, share - 0.04, puddle);
    const rim = 1 - smoothstep(share + 0.08, share, puddle) * (1 - pooled) * 0.2;
    r *= rim;
    g *= rim;
    b *= rim;
    if (pooled > 0) {
      const [wr, wg, wb] = water(x, y);
      const deep = DEEPNESS[s] * 0.7;
      const muddy = 0.15 * (1 - unit(s / RES - 4));
      const shown = SHOWN[s] * pooled;
      r += (wr + (DEEP[0] - wr) * deep + (MUD[0] - wr) * muddy - r) * shown;
      g += (wg + (DEEP[1] - wg) * deep + (MUD[1] - wg) * muddy - g) * shown;
      b += (wb + (DEEP[2] - wb) * deep + (MUD[2] - wb) * muddy - b) * shown;
    }
  }
  out[o] = r;
  out[o + 1] = g;
  out[o + 2] = b;
}

/** A ground texel as it looks at `stage` (see gradeInto). */
export function gradeTexel(c: RGB, stage: number, puddle: number, crack: number, water: RGB): RGB {
  if (Math.abs(stage - WETNESS.normal) < 1e-3) return [...c];
  const out = new Uint8ClampedArray(3);
  gradeInto(out, 0, c[0], c[1], c[2], stageIndex(stage), puddle, crack, () => water, 0, 0);
  return [out[0], out[1], out[2]];
}

/** Per pixel of a repeating square tile: how low the spot lies (puddles, 0–255 evenly spread) and cracks (255 on a crack). */
export interface GroundDetail {
  size: number;
  puddle: Uint8Array;
  crack: Uint8Array;
}

/** Puddle blobs and crack cells, in pixels. */
const PUDDLE_CELLS = [12, 24, 48];
const CRACK_CELL = 12;
const CRACK_WIDTH = 0.6;

export function groundDetail(seed: number, size = 512): GroundDetail {
  const n = size * size;
  // Puddles: smooth noise, its values spread evenly so a share of the spots is that share of the ground.
  const noise = Float32Array.from({ length: n }, (_, i) => {
    const [x, y] = [i % size, Math.floor(i / size)];
    return PUDDLE_CELLS.reduce((s, cells, k) => s + tileableValueNoise2D((x * cells) / size, (y * cells) / size, cells, seed + k) / 2 ** k, 0);
  });
  const rank = Uint32Array.from({ length: n }, (_, i) => i).sort((a, b) => noise[a] - noise[b]);
  const puddle = new Uint8Array(n);
  rank.forEach((i, k) => (puddle[i] = Math.floor((k / n) * 256)));
  // Cracks: the borders of wobbly cells around scattered points.
  const cells = size / CRACK_CELL;
  const point = (cx: number, cy: number) => {
    const [wx, wy] = [((cx % cells) + cells) % cells, ((cy % cells) + cells) % cells];
    return [(cx + hash2(wx, wy, seed + 7)) * CRACK_CELL, (cy + hash2(wx, wy, seed + 8)) * CRACK_CELL];
  };
  const crack = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const wobble = (k: number) => (tileableValueNoise2D(((i % size) * cells) / size / 2, (Math.floor(i / size) * cells) / size / 2, cells / 2, seed + k) - 0.5) * 6;
    const [x, y] = [(i % size) + wobble(20), Math.floor(i / size) + wobble(21)];
    const [cx, cy] = [Math.floor(x / CRACK_CELL), Math.floor(y / CRACK_CELL)];
    let [f1, f2] = [Infinity, Infinity];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const [px, py] = point(cx + dx, cy + dy);
        const d = Math.hypot(x - px, y - py);
        if (d < f1) [f1, f2] = [d, f1];
        else if (d < f2) f2 = d;
      }
    }
    crack[i] = Math.round(255 * smoothstep(CRACK_WIDTH * 2, 0, f2 - f1));
  }
  return { size, puddle, crack };
}

/**
 * Grade `base` into `out` by the wetness field (per hex, blended), leaving
 * pixels marked in `keep` (open water, off the map) as they are. `out` may be
 * the map squashed vertically by `squash` (projected): each of its rows shows
 * the row of `base` it falls on. `water(x, y)` is the water's colour at a
 * pixel of `base`, asked only where water shows.
 */
export function gradeGround(
  base: Raster,
  out: Raster,
  blend: HexBlend,
  field: Float32Array,
  keep: Uint8Array,
  detail: GroundDetail,
  water: (x: number, y: number) => RGB,
  squash = 1,
): void {
  const { width: W, height: H, data } = base;
  const mask = detail.size - 1;
  for (let py = 0; py < out.height; py++) {
    const y = Math.min(H - 1, Math.floor((py + 0.5) / squash));
    out.data.set(data.subarray(y * W * 4, (y + 1) * W * 4), py * W * 4);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (keep[i] || !data[i * 4 + 3]) continue;
      const stage = sampleField(blend, field, x + 0.5, y + 0.5);
      if (Math.abs(stage - WETNESS.normal) < 0.01) continue;
      const d = (y & mask) * detail.size + (x & mask);
      const o = i * 4;
      gradeInto(out.data, (py * W + x) * 4, data[o], data[o + 1], data[o + 2], stageIndex(stage), detail.puddle[d] / 255, detail.crack[d] / 255, water, x, y);
    }
  }
}
