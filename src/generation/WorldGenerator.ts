import { World } from '../world/World';
import { generateHeights } from './HeightGenerator';
import type { config } from '../config/parameters';

type Cfg = typeof config;

/**
 * Builds a fresh world from the current config. Future generation passes
 * (rivers, biomes, settlements …) get appended here in a fixed order.
 */
export function buildWorld(cfg: Cfg): World {
  const world = new World(cfg.gridWidth, cfg.gridHeight);
  generateHeights(world, {
    seed: cfg.seed,
    noiseScale: cfg.noiseScale,
    noiseOctaves: cfg.noiseOctaves,
    noisePersistence: cfg.noisePersistence,
    noiseLacunarity: cfg.noiseLacunarity,
    heightExponent: cfg.heightExponent,
    mountainBoost: cfg.mountainBoost,
  });
  return world;
}
