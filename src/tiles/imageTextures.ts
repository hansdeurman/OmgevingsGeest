import { withDerivedFuses } from './derivedTextures';
import type { WallImages } from './IsoRenderer';
import { loadImage } from './imageSprites';
import type { GroundKind } from './groundShader';
import type { GroundTextures } from './placeholderTextures';
import type { Raster } from './raster';
import { makeSeamless } from './seamless';

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

async function loadRaster(url: string, width: number, height = width): Promise<Raster> {
  const img = await loadImage(url);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);
  return { width, height, data: ctx.getImageData(0, 0, width, height).data };
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
