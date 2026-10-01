import { fbm2D } from '../math/noise';
import { mulberry32 } from '../math/rng';
import { clamp } from '../math/scalar';
import { createCoverGrid, type CoverGrid } from './coverGrid';
import { LEVEL_NAMES, MAX_LEVEL, type Cover, type Layer, type Level } from './levels';

export interface MapLabel {
  col: number;
  row: number;
  text: string;
}

export interface DemoMap {
  grid: CoverGrid;
  labels: MapLabel[];
}

export interface DemoMapDef {
  id: string;
  name: string;
  build(seed: number): DemoMap;
}

const level = (v: number): Level => (clamp(Math.round(v), 0, MAX_LEVEL) || 0) as Level;

/** Showcase bands: three rows per layer, levels 0..4 left to right, sand rows between. */
export const LEVEL_BANDS: ReadonlyArray<{ layer: Layer; row: number }> = [
  { layer: 'water', row: 0 },
  { layer: 'grass', row: 4 },
  { layer: 'trees', row: 8 },
];
const GROUP = 3;

function levelsShowcase(): DemoMap {
  const bandAt = (row: number) => LEVEL_BANDS.find((b) => row >= b.row && row < b.row + GROUP);
  const grid = createCoverGrid(GROUP * (MAX_LEVEL + 1), 11, (col, row) => {
    const band = bandAt(row);
    return band ? { [band.layer]: level(Math.floor(col / GROUP)) } : {};
  });
  const labels = LEVEL_BANDS.flatMap(({ layer, row }) =>
    LEVEL_NAMES[layer].map((name, l) => ({ col: l * GROUP + 1, row, text: `${l} · ${name}` })),
  );
  return { grid, labels };
}

/** Noise-driven island: deep sea outside, beaches, meadows and forest patches inland. */
function island(seed: number): DemoMap {
  const cols = 22;
  const rows = 16;
  const noise = (s: number, x: number, y: number) =>
    fbm2D(x, y, { seed: seed * 7 + s, octaves: 4, persistence: 0.5, lacunarity: 2 });
  const grid = createCoverGrid(cols, rows, (col, row): Partial<Cover> => {
    const nx = ((col + (row & 1) * 0.5) / (cols - 0.5)) * 2 - 1;
    const ny = (row / (rows - 1)) * 2 - 1;
    const e = noise(0, nx * 2.2, ny * 2.2) * 0.9 + (1 - Math.hypot(nx, ny)) * 0.8 - 0.33;
    if (e < 0.3) {
      const water = e < 0.1 ? 4 : e < 0.18 ? 3 : e < 0.25 ? 2 : 1;
      return water >= 2 ? { water } : { water, grass: level(noise(1, nx * 3, ny * 3) * 2 - 0.5) };
    }
    const h = e - 0.3;
    const grass = level(h * 9 + (noise(1, nx * 3, ny * 3) - 0.5) * 6);
    const trees = h > 0.06 ? level((noise(2, nx * 3.5, ny * 3.5) - 0.42) * 14 + h * 4) : 0;
    return { grass, trees };
  });
  return { grid, labels: [] };
}

/** Every hex random: a stress test for how well arbitrary neighbours fuse. */
function randomMix(seed: number): DemoMap {
  const rng = mulberry32(seed);
  const pick = () => level(rng() * (MAX_LEVEL + 1) - 0.5);
  const grid = createCoverGrid(14, 10, (): Partial<Cover> => {
    const water = rng() < 0.25 ? pick() : 0;
    return water >= 2 ? { water } : { water, grass: pick(), trees: rng() < 0.5 ? pick() : 0 };
  });
  return { grid, labels: [] };
}

export const DEMO_MAPS: readonly DemoMapDef[] = [
  { id: 'levels', name: 'Levels showcase', build: levelsShowcase },
  { id: 'island', name: 'Island', build: island },
  { id: 'random', name: 'Random mix', build: randomMix },
];

export function demoMap(id: string, seed: number): DemoMap {
  return (DEMO_MAPS.find((m) => m.id === id) ?? DEMO_MAPS[0]).build(seed);
}
