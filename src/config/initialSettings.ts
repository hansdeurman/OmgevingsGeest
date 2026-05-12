/**
 * Starting configuration values. Every key here overrides the corresponding
 * parameter's `default` in `parameterDefs`; any key missing from this map
 * falls back to its metadata default.
 *
 * Sourced from a "Save Settings" snapshot of build 9149567 that produced a
 * peaceful-but-lively flow with wall-glide redirection. Treat this file as
 * the canonical "preset" the dev page loads on first paint — edit it (or
 * paste a fresh snapshot into it) to change the boot defaults.
 */
export const initialSettings: Record<string, number | boolean> = {
  // World
  seed: 1337,
  hexCount: 40,
  // Terrain
  noiseScale: 0.06,
  noiseOctaves: 5,
  noisePersistence: 0.5,
  noiseLacunarity: 2,
  heightExponent: 1.4,
  mountainBoost: 0.35,
  // Render
  showGrid: false,
  showHeights: false,
  shadeStrength: 0.65,
  showDensity: true,
  densityDisplayMax: 3,
  // Wind
  showAirFlow: true,
  windAmbientSpeed: 0,
  windAmbientAngle: 0,
  windDamping: 0.02,
  windTerrainCoupling: 29,
  windTerrainHorizon: 5,
  windTerrainDeflect: 80,
  windDownhillRatio: 0.01,
  windOvercomeFactor: 0.1,
  windMaxSpeed: 8,
  windAdvection: 27.5,
  windSmoothing: 0,
  windDensityBaseline: 1,
  windDensityDamping: 0.15,
  windPressure: 0,
  windVelocityDensityCoupling: 6,
  windHeightDensityLoss: 1,
  windDensityDiffusion: 2,
  windTurbulence: 0.1,
  arrowStride: 1,
  arrowScale: 8,
  // Placement
  placeSpeed: 8,
  placeDensity: 13.4,
  placeOnTime: 0.3,
  placePeriod: 2,
  sinkRate: 3,
};
