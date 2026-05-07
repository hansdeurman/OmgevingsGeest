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

/** Visual hex radius in world units. Constant for now — the renderer reads
 * this directly. Promote it to a slider again later if needed. */
export const HEX_PIXEL_SIZE = 4;

/** Aspect ratio for the auto-derived grid: rows / cols. */
const GRID_ASPECT = 0.75;

export const parameterDefs: ParamMeta[] = [
  // World
  { key: 'seed', label: 'Seed', group: 'World', type: 'int', min: 0, max: 99999, step: 1, default: 1337, affectsGeneration: true },
  { key: 'hexCount', label: 'Hex Count', group: 'World', type: 'int', min: 20, max: 400, step: 1, default: 120, affectsGeneration: true },

  // Terrain
  { key: 'noiseScale', label: 'Noise Scale', group: 'Terrain', type: 'number', min: 0.005, max: 0.4, step: 0.001, default: 0.06, affectsGeneration: true },
  { key: 'noiseOctaves', label: 'Octaves', group: 'Terrain', type: 'int', min: 1, max: 8, step: 1, default: 5, affectsGeneration: true },
  { key: 'noisePersistence', label: 'Persistence', group: 'Terrain', type: 'number', min: 0.1, max: 1.0, step: 0.01, default: 0.5, affectsGeneration: true },
  { key: 'noiseLacunarity', label: 'Lacunarity', group: 'Terrain', type: 'number', min: 1.0, max: 4.0, step: 0.05, default: 2.0, affectsGeneration: true },
  { key: 'heightExponent', label: 'Height Curve', group: 'Terrain', type: 'number', min: 0.3, max: 4.0, step: 0.05, default: 1.4, affectsGeneration: true },
  { key: 'mountainBoost', label: 'Mountain Boost', group: 'Terrain', type: 'number', min: 0, max: 1.5, step: 0.01, default: 0.35, affectsGeneration: true },

  // Render
  { key: 'showGrid', label: 'Show Grid', group: 'Render', type: 'boolean', default: false },
  { key: 'showHeights', label: 'Show Heights', group: 'Render', type: 'boolean', default: false },
  { key: 'shadeStrength', label: 'Shading', group: 'Render', type: 'number', min: 0, max: 1, step: 0.01, default: 0.45 },

  // Wind — runs the airflow simulation and draws arrows over the terrain.
  { key: 'showAirFlow', label: 'Show Air Flow', group: 'Wind', type: 'boolean', default: true },
  // Ambient wind continuously injects energy. Default off so user-placed
  // sources are the only driver and the system isn't constantly forced.
  { key: 'windAmbientSpeed', label: 'Ambient Speed', group: 'Wind', type: 'number', min: 0, max: 3, step: 0.01, default: 0 },
  { key: 'windAmbientAngle', label: 'Ambient Angle', group: 'Wind', type: 'int', min: 0, max: 359, step: 1, default: 0 },
  // Friction. Very mild by default so wind from a source travels far and dies
  // off slowly, with no decay at all when set to 0.
  { key: 'windDamping', label: 'Damping', group: 'Wind', type: 'number', min: 0, max: 5, step: 0.005, default: 0.05 },
  { key: 'windTerrainCoupling', label: 'Terrain Coupling', group: 'Wind', type: 'number', min: 0, max: 60, step: 0.5, default: 20 },
  // Ratio of "pulled downhill" force to "blocked uphill" force. 0 = pure
  // uphill block; 1 = symmetric. Realistic values 0.2..0.5 — air slides
  // down but the block-up effect dominates.
  { key: 'windDownhillRatio', label: 'Downhill Ratio', group: 'Wind', type: 'number', min: 0, max: 1, step: 0.01, default: 0.3 },
  { key: 'windOvercomeFactor', label: 'Overcome', group: 'Wind', type: 'number', min: 0, max: 3, step: 0.01, default: 0.5 },
  { key: 'windMaxSpeed', label: 'Max Speed', group: 'Wind', type: 'number', min: 0.1, max: 5, step: 0.05, default: 2.5 },
  { key: 'windAdvection', label: 'Propagation', group: 'Wind', type: 'number', min: 0, max: 50, step: 0.5, default: 12 },
  { key: 'windSmoothing', label: 'Smoothing', group: 'Wind', type: 'number', min: 0, max: 1, step: 0.01, default: 0.05 },
  // Density evaporates slowly as the parcel travels — distinct from velocity
  // damping so we can tune "how visible is the wave" independently from
  // "how quickly does flow strength die out".
  { key: 'windDensityDamping', label: 'Density Damping', group: 'Wind', type: 'number', min: 0, max: 2, step: 0.005, default: 0.08 },
  // Pressure: high-density cells push velocity outward toward low-density
  // cells. This is what lets the system circulate (back to sinks) instead of
  // equilibrating. Set to 0 for the older velocity-only behaviour.
  { key: 'windPressure', label: 'Pressure', group: 'Wind', type: 'number', min: 0, max: 5, step: 0.05, default: 1.5 },
  // Density loss when air climbs a slope (per unit normalised height delta,
  // applied as exp(-dh * loss) on the inflow term). Default ~1 = a parcel
  // crossing a 0.3-tall ridge keeps ~74% of its density.
  { key: 'windHeightDensityLoss', label: 'Height Loss', group: 'Wind', type: 'number', min: 0, max: 5, step: 0.05, default: 1 },
  // Random per-step forcing. Breaks symmetry on otherwise-static convergent
  // flows; the field stops looking frozen, wind wobbles and finds escape
  // paths between sources. Zero = fully deterministic.
  { key: 'windTurbulence', label: 'Turbulence', group: 'Wind', type: 'number', min: 0, max: 5, step: 0.05, default: 0.5 },
  { key: 'arrowStride', label: 'Arrow Density', group: 'Wind', type: 'int', min: 1, max: 10, step: 1, default: 1 },
  { key: 'arrowScale', label: 'Arrow Scale', group: 'Wind', type: 'number', min: 1, max: 30, step: 0.5, default: 8 },

  // Burst tooling — directional test buttons + drag-placed periodic sources.
  { key: 'showDensity', label: 'Show Density', group: 'Burst', type: 'boolean', default: true },
  { key: 'burstSpeed', label: 'Burst Speed', group: 'Burst', type: 'number', min: 0.1, max: 5, step: 0.1, default: 2 },
  { key: 'burstDensity', label: 'Burst Density', group: 'Burst', type: 'number', min: 0.1, max: 5, step: 0.1, default: 1 },
  // Burst-source duty cycle (snapshotted at placement). Duration is how long
  // each pulse stays "on"; period is the gap between pulse starts.
  { key: 'burstDuration', label: 'On Time', group: 'Burst', type: 'number', min: 0.05, max: 5, step: 0.05, default: 0.3 },
  { key: 'burstPeriod', label: 'Period', group: 'Burst', type: 'number', min: 0.1, max: 10, step: 0.1, default: 2.0 },
  // Sink drain rate (density units removed per second). Match to a paired
  // source's effective output if you want roughly conservative flow.
  { key: 'sinkRate', label: 'Sink Rate', group: 'Burst', type: 'number', min: 0.1, max: 20, step: 0.1, default: 3 },
];

/** Derive the rectangular grid dimensions from a single hex-count knob. */
export function gridDimensions(hexCount: number): { width: number; height: number } {
  return { width: hexCount, height: Math.max(1, Math.round(hexCount * GRID_ASPECT)) };
}

type Defaults = Record<string, number | boolean>;
const defaults: Defaults = {};
for (const p of parameterDefs) defaults[p.key] = p.default;

/**
 * Reactive global config. Read it from anywhere; the dev UI mutates it in place.
 */
export const config = reactive(defaults) as Record<string, number | boolean> & {
  // Convenience typing for known keys.
  seed: number;
  hexCount: number;
  noiseScale: number;
  noiseOctaves: number;
  noisePersistence: number;
  noiseLacunarity: number;
  heightExponent: number;
  mountainBoost: number;
  showGrid: boolean;
  showHeights: boolean;
  shadeStrength: number;
  showAirFlow: boolean;
  windAmbientSpeed: number;
  windAmbientAngle: number;
  windDamping: number;
  windTerrainCoupling: number;
  windDownhillRatio: number;
  windOvercomeFactor: number;
  windMaxSpeed: number;
  windAdvection: number;
  windSmoothing: number;
  windDensityDamping: number;
  windPressure: number;
  windHeightDensityLoss: number;
  windTurbulence: number;
  arrowStride: number;
  arrowScale: number;
  showDensity: boolean;
  burstSpeed: number;
  burstDensity: number;
  burstDuration: number;
  burstPeriod: number;
  sinkRate: number;
};

export const generationKeys = parameterDefs
  .filter((p) => p.affectsGeneration)
  .map((p) => p.key);
