import { withDerivedFuses } from './derivedTextures';
import type { LakeKit, WallStyle } from './highLakes';
import type { WallImages } from './IsoRenderer';
import { loadImage } from './imageSprites';
import type { GroundKind } from './groundShader';
import type { GroundTextures } from './placeholderTextures';
import type { Raster } from './raster';
import { makeSeamless } from './seamless';
import type { WallStrip } from './wallStrip';
import type { WaterKind } from './waterLook';

export type TextureFiles = Partial<Record<GroundKind, string[]>>;

/** Generated ground art in public/tiles/. Kinds without files keep their placeholders. */
export const TEXTURE_FILES: TextureFiles = {
  sand: ['sand-1.webp'],
  grass: ['grass-1.webp'],
  water: ['water-1.webp'],
  rock: ['rock-1.webp'],
  snow: ['snow-1.webp', 'snow-2.webp'],
};

/** Pixel size textures are scaled to; at hex radius 40 one texture spans ~2.3 hexes. */
export const TEXTURE_SIZE = 160;

/** Wall art in public/tiles/: seamless left to right, seen from the front. */
export const WALL_FILES: Record<keyof WallImages, string> = {
  earth: 'wall-1.webp',
  rock: 'wall-2.webp',
};

function rasterOf(img: HTMLImageElement, width: number, height: number): Raster {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);
  return { width, height, data: ctx.getImageData(0, 0, width, height).data };
}

async function loadRaster(url: string, width: number, height = width): Promise<Raster> {
  return rasterOf(await loadImage(url), width, height);
}

/** Load, downscale and seam-fix every listed texture, then derive missing fuse textures. */
export async function loadGroundTextures(files: TextureFiles, size = TEXTURE_SIZE): Promise<Partial<GroundTextures>> {
  const base = `${import.meta.env.BASE_URL}tiles/`;
  const entries = await Promise.all(
    Object.entries(files).map(async ([kind, names]) => {
      const rasters = await Promise.all(names.map((n) => loadRaster(base + n, size)));
      return [kind, rasters.map((r) => makeSeamless(r))] as const;
    }),
  );
  return withDerivedFuses(Object.fromEntries(entries));
}

export async function loadWalls(files = WALL_FILES): Promise<WallImages> {
  const base = `${import.meta.env.BASE_URL}tiles/`;
  const entries = await Promise.all(Object.entries(files).map(async ([kind, name]) => [kind, await loadImage(base + name)] as const));
  return Object.fromEntries(entries);
}

/** The painted cliff under raised water; it repeats about every 2.2 hex radii and is stretched to each drop. */
export async function loadPoolFace(hexSize: number, file = 'cliff-1.webp'): Promise<Raster> {
  const width = Math.round(2.2 * hexSize);
  return loadRaster(`${import.meta.env.BASE_URL}tiles/${file}`, width, Math.round(width * 0.7));
}

/** The rock wall as a raster for steep mountain faces; it repeats about every 2.6 hex radii. */
export async function loadCliff(hexSize: number, file = WALL_FILES.rock): Promise<Raster> {
  const width = Math.round(2.6 * hexSize);
  return loadRaster(`${import.meta.env.BASE_URL}tiles/${file}`, width, width);
}

/** A wall strip in public/tiles/lake/ and its rows, as tools/make_wall.py measured them. */
interface StripFile {
  file: string;
  lip: number;
  from: number;
  to: number;
}

const LAKE_WALLS: Record<WallStyle, StripFile> = {
  mossy: { file: 'wall-mossy.webp', lip: 21, from: 143, to: 337 },
  grey: { file: 'wall-grey.webp', lip: 21, from: 143, to: 337 },
  snowy: { file: 'wall-snowy.webp', lip: 44, from: 164, to: 358 },
};
const SPILL_WALLS: StripFile[] = [
  { file: 'overflow-1.webp', lip: 24, from: 142, to: 271 },
  { file: 'overflow-2.webp', lip: 20, from: 142, to: 271 },
  { file: 'overflow-3.webp', lip: 20, from: 142, to: 271 },
];
const OUTFALL: StripFile = { file: 'outfall.webp', lip: 20, from: 103, to: 277 };
const WATER_FILES: Record<WaterKind, string> = { ice: 'water-ice.webp', cold: 'water-cold.webp', mild: 'water-mild.webp', warm: 'water-warm.webp' };
/** Lake walls repeat about every this many hex radii; the art is about this wide. */
const LAKE_WALL_REPEAT = 2.2;
const LAKE_WALL_ART = 412;
/** Pixel size water textures are scaled to: one blotch of the art is about a hex across. */
const WATER_SIZE = 256;

/** Every lake wall at one scale (art px → scene px), so their stones match. */
async function loadStrip(meta: StripFile, k: number): Promise<WallStrip> {
  const img = await loadImage(`${import.meta.env.BASE_URL}tiles/lake/${meta.file}`);
  const image = rasterOf(img, Math.round(img.naturalWidth * k), Math.round(img.naturalHeight * k));
  return { image, lip: Math.round(meta.lip * k), from: Math.round(meta.from * k), to: Math.round(meta.to * k) };
}

const mapValues = async <K extends string, V, R>(rec: Record<K, V>, f: (v: V) => Promise<R>): Promise<Record<K, R>> =>
  Object.fromEntries(await Promise.all(Object.entries<V>(rec).map(async ([k, v]) => [k, await f(v)] as const))) as Record<K, R>;

export async function loadLakeKit(hexSize: number): Promise<LakeKit> {
  const k = (LAKE_WALL_REPEAT * hexSize) / LAKE_WALL_ART;
  const [walls, spill, outfall, water] = await Promise.all([
    mapValues(LAKE_WALLS, (m) => loadStrip(m, k)),
    Promise.all(SPILL_WALLS.map((m) => loadStrip(m, k))),
    loadStrip(OUTFALL, k),
    mapValues(WATER_FILES, async (f) => makeSeamless(await loadRaster(`${import.meta.env.BASE_URL}tiles/lake/${f}`, WATER_SIZE))),
  ]);
  return { walls, spill, outfall, water };
}
