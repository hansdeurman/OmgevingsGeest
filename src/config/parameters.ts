import { reactive } from 'vue';

export type ParamType = 'number' | 'int' | 'boolean';

/**
 * Metadata for a single tweakable parameter. The dev UI auto-renders any
 * parameter registered here, so adding new knobs is a one-line change.
 */
export interface ParamMeta {
  key: string;
  label: string;
  group: string;
  type: ParamType;
  min?: number;
  max?: number;
  step?: number;
  default: number | boolean;
  /** When true, mutating this param triggers a world regeneration. */
  affectsGeneration?: boolean;
}

export const parameterDefs: ParamMeta[] = [
  // World
  { key: 'seed', label: 'Seed', group: 'World', type: 'int', min: 0, max: 99999, step: 1, default: 1337, affectsGeneration: true },
  { key: 'gridWidth', label: 'Width', group: 'World', type: 'int', min: 8, max: 200, step: 1, default: 80, affectsGeneration: true },
  { key: 'gridHeight', label: 'Height', group: 'World', type: 'int', min: 8, max: 200, step: 1, default: 60, affectsGeneration: true },

  // Terrain
  { key: 'noiseScale', label: 'Noise Scale', group: 'Terrain', type: 'number', min: 0.005, max: 0.4, step: 0.001, default: 0.06, affectsGeneration: true },
  { key: 'noiseOctaves', label: 'Octaves', group: 'Terrain', type: 'int', min: 1, max: 8, step: 1, default: 5, affectsGeneration: true },
  { key: 'noisePersistence', label: 'Persistence', group: 'Terrain', type: 'number', min: 0.1, max: 1.0, step: 0.01, default: 0.5, affectsGeneration: true },
  { key: 'noiseLacunarity', label: 'Lacunarity', group: 'Terrain', type: 'number', min: 1.0, max: 4.0, step: 0.05, default: 2.0, affectsGeneration: true },
  { key: 'heightExponent', label: 'Height Curve', group: 'Terrain', type: 'number', min: 0.3, max: 4.0, step: 0.05, default: 1.4, affectsGeneration: true },
  { key: 'mountainBoost', label: 'Mountain Boost', group: 'Terrain', type: 'number', min: 0, max: 1.5, step: 0.01, default: 0.35, affectsGeneration: true },

  // Render
  { key: 'hexSize', label: 'Hex Size', group: 'Render', type: 'number', min: 4, max: 60, step: 0.5, default: 12 },
  { key: 'showGrid', label: 'Show Grid', group: 'Render', type: 'boolean', default: false },
  { key: 'shadeStrength', label: 'Shading', group: 'Render', type: 'number', min: 0, max: 1, step: 0.01, default: 0.45 },
];

type Defaults = Record<string, number | boolean>;
const defaults: Defaults = {};
for (const p of parameterDefs) defaults[p.key] = p.default;

/**
 * Reactive global config. Read it from anywhere; the dev UI mutates it in place.
 */
export const config = reactive(defaults) as Record<string, number | boolean> & {
  // Convenience typing for known keys.
  seed: number;
  gridWidth: number;
  gridHeight: number;
  noiseScale: number;
  noiseOctaves: number;
  noisePersistence: number;
  noiseLacunarity: number;
  heightExponent: number;
  mountainBoost: number;
  hexSize: number;
  showGrid: boolean;
  shadeStrength: number;
};

export const generationKeys = parameterDefs
  .filter((p) => p.affectsGeneration)
  .map((p) => p.key);
