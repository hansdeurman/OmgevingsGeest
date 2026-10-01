import { withDerivedFuses } from './derivedTextures';
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
};

/** Pixel size textures are scaled to; at hex radius 40 one texture spans ~2.3 hexes. */
export const TEXTURE_SIZE = 160;

async function loadRaster(url: string, size: number): Promise<Raster> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, size, size);
  return { width: size, height: size, data: ctx.getImageData(0, 0, size, size).data };
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
