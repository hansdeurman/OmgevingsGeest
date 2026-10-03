import { fbm2D, type FbmOptions } from '../math/noise';
import { smoothstep } from '../math/scalar';
import type { CoverGrid } from './coverGrid';
import { createCoverField, type CoverField } from './coverField';
import { FIELDS, type Amounts } from './levels';

/** Maximum noise added per field; this is what makes boundaries organic. */
export const WOBBLE: Readonly<Amounts> = { water: 0.25, grass: 0.32, trees: 0.25, alt: 0.05 };

/**
 * The cover field plus a little noise per layer. Noise fades out where a
 * layer is absent, so empty hexes stay clean and only boundaries and
 * partially covered hexes get irregular shapes. Ground shading and prop
 * placement both read this sampler, so trees never stand in drawn water.
 */
export function createTerrainSampler(grid: CoverGrid, size: number, blend: number, seed: number): CoverField {
  const field = createCoverField(grid, size, blend);
  const scale = 1 / (0.5 * size);
  const noise: FbmOptions[] = FIELDS.map((_, i) => ({
    seed: seed + 1000 * (i + 1),
    octaves: 3,
    persistence: 0.5,
    lacunarity: 2,
  }));

  function sample(x: number, y: number, out?: Amounts): Amounts {
    const a = field.sample(x, y, out);
    for (let i = 0; i < FIELDS.length; i++) {
      const f = FIELDS[i];
      const amount = a[f];
      if (amount <= 0) continue; // no layer, no noise
      a[f] = amount + (fbm2D(x * scale, y * scale, noise[i]) - 0.5) * 2 * WOBBLE[f] * smoothstep(0, 0.15, amount);
    }
    return a;
  }

  return { sample, inside: field.inside };
}
