import { fbm2D } from '../math/noise';
import type { World } from '../world/World';

export interface HeightParams {
  seed: number;
  noiseScale: number;
  noiseOctaves: number;
  noisePersistence: number;
  noiseLacunarity: number;
  heightExponent: number;
  mountainBoost: number;
}

/**
 * Fills tile.height with values in [0, 1] using fBm value noise. A power
 * curve sharpens valleys and a ridged term boosts the high end so peaks stand
 * out as mountains rather than gentle hills.
 */
export function generateHeights(world: World, p: HeightParams): void {
  const ridgeSeed = p.seed ^ 0x9e3779b1;
  for (const tile of world.tiles) {
    const x = tile.col * p.noiseScale;
    const y = tile.row * p.noiseScale;

    const base = fbm2D(x, y, {
      seed: p.seed,
      octaves: p.noiseOctaves,
      persistence: p.noisePersistence,
      lacunarity: p.noiseLacunarity,
    });

    // Ridged noise: 1 - |2n - 1|, squared. Concentrates energy on ridges.
    const r = fbm2D(x * 1.7, y * 1.7, {
      seed: ridgeSeed,
      octaves: Math.max(2, p.noiseOctaves - 1),
      persistence: p.noisePersistence,
      lacunarity: p.noiseLacunarity,
    });
    const ridged = 1 - Math.abs(2 * r - 1);

    let h = base * (1 - p.mountainBoost) + ridged * ridged * p.mountainBoost;
    h = Math.pow(Math.max(0, Math.min(1, h)), p.heightExponent);
    tile.height = h;
  }
}
