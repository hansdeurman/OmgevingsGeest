import { mulberry32 } from '../math/rng';
import { fbm2D } from '../math/noise';
import { smoothstep } from '../math/scalar';
import { createRaster, setPixel, type Raster } from '../tiles/raster';
import type { RGB } from '../rendering/palette';
import { SHAPES } from './cloudDeck';

/**
 * Placeholder cloud art, painted here until the real art is in: round
 * billows heaped on a flat base (or, for rain, a low wide bank), lit from
 * the upper left like the rest of the map, cool lavender-grey in the shade
 * and darker underneath, with soft edges on a clear ground.
 */
export type CloudKind = 'heap' | 'bank';

/** Light from the upper left and a little in front, as on the map. */
const LIGHT = (() => {
  const [x, y, z] = [-0.55, -0.6, 0.6];
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
})();

const COLOURS: Record<CloudKind, { shade: RGB; lit: RGB; under: RGB }> = {
  heap: { shade: [182, 188, 214], lit: [255, 254, 248], under: [146, 152, 180] },
  bank: { shade: [160, 166, 184], lit: [236, 238, 244], under: [128, 134, 154] },
};

/** Billows (x, y, radius as shares of the canvas) of one cloud. */
function billows(kind: CloudKind, seed: number): [number, number, number][] {
  const random = mulberry32(seed * 31 + 7);
  const range = (a: number, b: number) => a + (b - a) * random();
  if (kind === 'bank')
    return Array.from({ length: 12 }, (_, k) => [0.1 + (0.8 * k) / 11 + range(-0.03, 0.03), 0.52 + range(-0.06, 0.06), 0.15 + range(0, 0.07)]);
  const heap = Array.from({ length: 26 }, (): [number, number, number] => {
    const x = range(0.16, 0.84);
    const dome = Math.sqrt(Math.max(0, 1 - ((x - 0.5) / 0.36) ** 2));
    return [x, 0.7 - dome * range(0.05, 0.42), 0.07 + 0.09 * random() * (0.6 + 0.4 * dome)];
  });
  const base = Array.from({ length: 6 }, (_, k): [number, number, number] => [0.22 + (0.56 * k) / 5, 0.72, 0.1]);
  const body = Array.from({ length: 3 }, (_, k): [number, number, number] => [0.34 + 0.16 * k, 0.6, 0.17]); // no holes through it
  return [...heap, ...base, ...body];
}

/** How much cloud there is at each pixel (0–1): the billows' union, ruffled at the edge. */
function density(w: number, h: number, kind: CloudKind, seed: number): Float32Array {
  const bumps = billows(kind, seed).map(([x, y, r]) => ({ x: x * w, y: y * h, r2: (r * Math.min(w, h)) ** 2 }));
  const noise = { seed: seed * 13 + 1, octaves: 3, persistence: 0.5, lacunarity: 2 };
  const ruffle = kind === 'bank' ? 0.16 : 0.08;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let empty = 1;
      for (const b of bumps) {
        const t = ((x - b.x) ** 2 + (y - b.y) ** 2) / b.r2;
        if (t < 5) empty *= 1 - 0.85 * Math.exp(-1.6 * t); // farther, a billow adds next to nothing
      }
      if (empty > 0.9) continue;
      const d = 1 - empty + (fbm2D(x / (w * 0.08), y / (w * 0.08), noise) - 0.5) * 2 * ruffle;
      const flatBase = kind === 'heap' ? smoothstep(0.86, 0.76, y / h) : 1;
      out[y * w + x] = Math.min(1, Math.max(0, d)) * flatBase;
    }
  return out;
}

export function paintCloud(w: number, h: number, seed: number, kind: CloudKind): Raster {
  const d = density(w, h, kind, seed);
  const height = d.map(Math.sqrt);
  const alpha = d.map((v) => smoothstep(0.32, 0.55, v));
  const rows = Array.from({ length: h }, (_, y) => y).filter((y) => alpha.subarray(y * w, (y + 1) * w).some((a) => a > 0.3));
  const [top, bottom] = [rows[0] ?? 0, rows.at(-1) ?? h];
  const { shade, lit, under } = COLOURS[kind];
  const at = (x: number, y: number) => height[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  const out = createRaster(w, h);
  for (let y = 0; y < h; y++) {
    const lower = 0.5 * smoothstep(0.5, 1, (y - top) / Math.max(1, bottom - top));
    for (let x = 0; x < w; x++) {
      const a = alpha[y * w + x];
      if (!a) continue;
      const [gx, gy] = [(at(x + 1, y) - at(x - 1, y)) * 30, (at(x, y + 1) - at(x, y - 1)) * 30];
      const norm = Math.hypot(gx, gy, 1);
      const light = Math.max(0, (-gx * LIGHT[0] - gy * LIGHT[1] + LIGHT[2]) / norm) ** 0.8;
      const colour = shade.map((s, c) => {
        const v = s + (lit[c] - s) * light;
        return v + (under[c] - v) * lower;
      }) as RGB;
      setPixel(out, x, y, colour, Math.round(a * 255));
    }
  }
  return out;
}

/** The kind of each placeholder shape: three heaps, one rain bank. */
const KINDS: readonly CloudKind[] = ['heap', 'heap', 'heap', 'bank'];

/** Every placeholder shape, `w` x `h` each, side by side in one raster. */
export function cloudAtlas(w: number, h: number): Raster {
  const atlas = createRaster(w * SHAPES, h);
  for (let k = 0; k < SHAPES; k++) {
    const cloud = paintCloud(w, h, k + 1, KINDS[k % KINDS.length]);
    for (let y = 0; y < h; y++) atlas.data.set(cloud.data.subarray(y * w * 4, (y + 1) * w * 4), (y * w * SHAPES + k * w) * 4);
  }
  return atlas;
}
