import { reactive } from 'vue';
import { initialSettings } from './initialSettings';

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
  // Simulation
  // Time scale: frame dt is multiplied by this before being fed to the
  // simulator. 1 = real-time, 0.5 = half speed, 0 = paused, >1 = faster.
  // Slows or accelerates the *whole* simulation without changing the
  // steady-state behaviour — same dynamics, just stretched in time.
  { key: 'simTimeScale', label: 'Time Scale', group: 'Simulation', type: 'number', min: 0, max: 3, step: 0.05, default: 1 },

  // World
  { key: 'seed', label: 'Seed', group: 'World', type: 'int', min: 0, max: 99999, step: 1, default: 1337, affectsGeneration: true },
  { key: 'hexCount', label: 'Hex Count', group: 'World', type: 'int', min: 20, max: 400, step: 1, default: 40, affectsGeneration: true },

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
  { key: 'shadeStrength', label: 'Shading', group: 'Render', type: 'number', min: 0, max: 1, step: 0.01, default: 0.65 },
  { key: 'showDensity', label: 'Show Density', group: 'Render', type: 'boolean', default: true },
  // Density value that saturates the colour ramp (red end of the arrows,
  // edge of the density backdrop). Tuning this rescales how density looks
  // but doesn't touch any source or any actual physics — sources keep the
  // density they were placed with.
  { key: 'densityDisplayMax', label: 'ρ Display Max', group: 'Render', type: 'number', min: 0.5, max: 20, step: 0.1, default: 3 },

  // Wind — runs the airflow simulation and draws arrows over the terrain.
  { key: 'showAirFlow', label: 'Show Air Flow', group: 'Wind', type: 'boolean', default: true },
  // Ambient wind continuously injects energy. Default off so user-placed
  // sources are the only driver and the system isn't constantly forced.
  { key: 'windAmbientSpeed', label: 'Ambient Speed', group: 'Wind', type: 'number', min: 0, max: 3, step: 0.01, default: 0 },
  { key: 'windAmbientAngle', label: 'Ambient Angle', group: 'Wind', type: 'int', min: 0, max: 359, step: 1, default: 0 },
  // Friction. Very mild by default so wind from a source travels far and dies
  // off slowly, with no decay at all when set to 0.
  { key: 'windDamping', label: 'Damping', group: 'Wind', type: 'number', min: 0, max: 5, step: 0.005, default: 0.05 },
  { key: 'windTerrainCoupling', label: 'Terrain Coupling', group: 'Wind', type: 'number', min: 0, max: 200, step: 1, default: 60 },
  // Wall-glide. When wind hits terrain head-on, a force kicks in along the
  // wall's tangent toward lower density — flow slides up/down the wall
  // instead of just piling up. 0 = pure deceleration (legacy); higher =
  // more aggressive lateral redirection.
  { key: 'windTerrainDeflect', label: 'Wall Glide', group: 'Wind', type: 'number', min: 0, max: 30, step: 0.1, default: 6 },
  // Ratio of "pulled downhill" force to "blocked uphill" force. 0 = pure
  // uphill block; 1 = symmetric. Realistic values 0.2..0.5 — air slides
  // down but the block-up effect dominates.
  { key: 'windDownhillRatio', label: 'Downhill Ratio', group: 'Wind', type: 'number', min: 0, max: 1, step: 0.01, default: 0.3 },
  // Lower = terrain stays strong even at high speed (default kept gentle so
  // a fast gust still tops the saddle). 0 = terrain is purely speed-blind.
  { key: 'windOvercomeFactor', label: 'Overcome', group: 'Wind', type: 'number', min: 0, max: 3, step: 0.01, default: 0.1 },
  { key: 'windMaxSpeed', label: 'Max Speed', group: 'Wind', type: 'number', min: 0.1, max: 30, step: 0.1, default: 8 },
  { key: 'windAdvection', label: 'Propagation', group: 'Wind', type: 'number', min: 0, max: 50, step: 0.5, default: 12 },
  // Sharpness of the edge-flux push (1 = broad isotropic 60° fan; higher
  // = tighter plume, all directions still treated equally).
  { key: 'windPushSharpness', label: 'Push Sharpness', group: 'Wind', type: 'number', min: 1, max: 12, step: 0.1, default: 3 },
  // Smoothing is purely cosmetic (averages each cell with its 6 neighbours).
  // Default 0 — the diffusion was muddying the parcel/no-parcel distinction
  // and propagating velocity into mountains.
  { key: 'windSmoothing', label: 'Smoothing', group: 'Wind', type: 'number', min: 0, max: 1, step: 0.01, default: 0 },
  // Baseline density. The whole field is initialised to this on world
  // build / Clear Field. Sources push density above; sinks pull below.
  // Deviations from this level are what drive flow — you don't have a
  // "where does the air go" problem because the field is always full.
  { key: 'windDensityBaseline', label: 'ρ Baseline', group: 'Wind', type: 'number', min: 0, max: 5, step: 0.05, default: 1 },
  // Per-second rate at which (density − baseline) relaxes toward zero.
  // 0 = density is fully conserved and a continuous source's parcel will
  // grow without bound. ~0.1 keeps the parcel size finite, tracking the
  // source's strength. Conservative: the baseline level is preserved, only
  // *deviations* decay.
  { key: 'windDensityDamping', label: 'Density Damping', group: 'Wind', type: 'number', min: 0, max: 2, step: 0.005, default: 0.1 },
  // Pressure: high-density cells push velocity outward toward low-density
  // cells. Keep this low for a peaceful, predictable flow — high values
  // cause source halos and radial counter-flow that fights the source's
  // intended emit direction. Crank up if you want a more "soup-like"
  // turbulent feel.
  { key: 'windPressure', label: 'Pressure', group: 'Wind', type: 'number', min: 0, max: 5, step: 0.05, default: 0.3 },
  // Velocity follows the parcel: cells without density bleed off velocity at
  // this rate (per second, scaled linearly by 1 - density/reference). Zero
  // = velocity is independent of density.
  { key: 'windVelocityDensityCoupling', label: 'V↔ρ Coupling', group: 'Wind', type: 'number', min: 0, max: 10, step: 0.05, default: 2.5 },
  // Density loss when air climbs a slope (per unit normalised height delta,
  // applied as exp(-dh * loss) on the inflow term). Default ~1 = a parcel
  // crossing a 0.3-tall ridge keeps ~74% of its density.
  { key: 'windHeightDensityLoss', label: 'Height Loss', group: 'Wind', type: 'number', min: 0, max: 5, step: 0.05, default: 1 },
  // Direct density diffusion rate. Density relaxes toward the terrain-
  // weighted neighbour average each second; high = dense air spreads to
  // sparse cells fast even without velocity carrying it.
  { key: 'windDensityDiffusion', label: 'ρ Diffusion', group: 'Wind', type: 'number', min: 0, max: 20, step: 0.1, default: 4 },
  // Random per-step forcing. Breaks symmetry on otherwise-static convergent
  // flows. Default is low (0.1) — enough to keep the field from being
  // perfectly frozen, not enough to make it feel unpredictable. Crank up
  // for a chaotic feel; set to 0 for fully deterministic playback.
  { key: 'windTurbulence', label: 'Turbulence', group: 'Wind', type: 'number', min: 0, max: 5, step: 0.05, default: 0.1 },
  { key: 'arrowStride', label: 'Arrow Density', group: 'Wind', type: 'int', min: 1, max: 10, step: 1, default: 1 },
  { key: 'arrowScale', label: 'Arrow Scale', group: 'Wind', type: 'number', min: 1, max: 30, step: 0.5, default: 8 },

  // Placement defaults. Every value here is *snapshotted* into a source
  // (or sink) at the moment it's dropped on the map and never changes for
  // that entity afterwards. Tuning these sliders affects only the NEXT
  // thing you place. Also drives the directional test-burst buttons.
  { key: 'placeSpeed',  label: 'Speed',     group: 'Placement', type: 'number', min: 0.1,  max: 30, step: 0.1,  default: 8 },
  { key: 'placeDensity', label: 'Density',  group: 'Placement', type: 'number', min: 0.1,  max: 20, step: 0.1,  default: 3 },
  // Burst-mode duty cycle (ignored for continuous-mode placements).
  // OnTime is how long each pulse stays "on"; Period is the cycle length.
  { key: 'placeOnTime', label: 'On Time',   group: 'Placement', type: 'number', min: 0.05, max: 5,  step: 0.05, default: 0.3 },
  { key: 'placePeriod', label: 'Period',    group: 'Placement', type: 'number', min: 0.1,  max: 10, step: 0.1,  default: 2.0 },
  // Sink drain rate (density units removed per second). Match to a paired
  // source's effective output if you want roughly conservative flow.
  { key: 'sinkRate',    label: 'Sink Rate', group: 'Placement', type: 'number', min: 0.1,  max: 20, step: 0.1,  default: 3 },
];

/** Derive the rectangular grid dimensions from a single hex-count knob. */
export function gridDimensions(hexCount: number): { width: number; height: number } {
  return { width: hexCount, height: Math.max(1, Math.round(hexCount * GRID_ASPECT)) };
}

type Defaults = Record<string, number | boolean>;
const defaults: Defaults = {};
for (const p of parameterDefs) {
  // `initialSettings` is the canonical starting preset. Any param missing
  // from that map keeps its metadata default — handy when adding a new
  // slider that doesn't have a saved value yet.
  defaults[p.key] = initialSettings[p.key] ?? p.default;
}

/**
 * Reactive global config. Read it from anywhere; the dev UI mutates it in place.
 */
export const config = reactive(defaults) as Record<string, number | boolean> & {
  // Convenience typing for known keys.
  simTimeScale: number;
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
  showDensity: boolean;
  densityDisplayMax: number;
  showAirFlow: boolean;
  windAmbientSpeed: number;
  windAmbientAngle: number;
  windDamping: number;
  windTerrainCoupling: number;
  windTerrainDeflect: number;
  windDownhillRatio: number;
  windOvercomeFactor: number;
  windMaxSpeed: number;
  windAdvection: number;
  windPushSharpness: number;
  windSmoothing: number;
  windDensityDamping: number;
  windDensityBaseline: number;
  windPressure: number;
  windVelocityDensityCoupling: number;
  windHeightDensityLoss: number;
  windDensityDiffusion: number;
  windTurbulence: number;
  arrowStride: number;
  arrowScale: number;
  placeSpeed: number;
  placeDensity: number;
  placeOnTime: number;
  placePeriod: number;
  sinkRate: number;
};

export const generationKeys = parameterDefs
  .filter((p) => p.affectsGeneration)
  .map((p) => p.key);
