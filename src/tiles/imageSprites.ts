import type { SpriteSet } from './placeholderSprites';
import type { PropKind } from './propRules';
import { scaleToMedian } from './spriteScale';

/** Number of cut-out sprites per kind in public/tiles/sprites/, named `<kind>-<n>.png`. */
export const SPRITE_COUNTS: Partial<Record<PropKind, number>> = {
  tree: 7,
  bush: 3,
  tuft: 3,
  reed: 2,
  flower: 4,
  pebble: 4,
  peak: 3,
  crag: 1,
  hill: 1,
  boulder: 1,
};

/** In-game height of a kind's median variant, in hex radii. */
export const SPRITE_HEIGHTS: Record<PropKind, number> = {
  tree: 0.75,
  bush: 0.27,
  tuft: 0.2,
  reed: 0.38,
  flower: 0.15,
  pebble: 0.09,
  boulder: 0.45,
  hill: 0.65,
  crag: 1.2,
  peak: 1.55,
};

/** Generated art carries no shadow; the renderer adds one this wide (share of sprite width). */
const SHADOW = 0.36;

export async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

export async function loadSprites(hexSize: number, counts = SPRITE_COUNTS): Promise<Partial<SpriteSet>> {
  const base = `${import.meta.env.BASE_URL}tiles/sprites/`;
  const entries = await Promise.all(
    Object.entries(counts).map(async ([kind, n]) => {
      const imgs = await Promise.all(Array.from({ length: n }, (_, i) => loadImage(`${base}${kind}-${i + 1}.png`)));
      const k = scaleToMedian(imgs.map((im) => im.naturalHeight), SPRITE_HEIGHTS[kind as PropKind] * hexSize);
      const sprites = imgs.map((image) => {
        const width = image.naturalWidth * k;
        return { image, width, height: image.naturalHeight * k, shadow: width * SHADOW };
      });
      return [kind, sprites] as const;
    }),
  );
  return Object.fromEntries(entries);
}
