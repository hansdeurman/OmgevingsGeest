import { fbm2D } from '../math/noise';
import { mulberry32 } from '../math/rng';
import { clamp, smoothstep } from '../math/scalar';
import { createCoverGrid, type CellInit, type CoverGrid } from './coverGrid';
import { fillDepressions } from './hydrology';
import { LEVEL_NAMES, MAX_ELEVATION, MAX_LEVEL, type Cover, type Layer, type Level } from './levels';
import { HIGH_LAKE_FROM } from './shores';

export interface MapLabel {
  col: number;
  row: number;
  text: string;
}

export interface DemoMap {
  grid: CoverGrid;
  labels: MapLabel[];
  /**
   * Water the high basins hold when rain has filled them, per cell (steps).
   * Their cells in `grid` are dry ground at its true height, so the water
   * can rise and fall over it; floodedGrid puts it back.
   */
  water?: number[];
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
/** Last band: meadow raised in steps of two terraces, from sea level to the snow line. */
export const ELEVATION_BAND_ROW = 12;

function levelsShowcase(): DemoMap {
  const bandAt = (row: number) => LEVEL_BANDS.find((b) => row >= b.row && row < b.row + GROUP);
  const grid = createCoverGrid(GROUP * (MAX_LEVEL + 1), ELEVATION_BAND_ROW + GROUP, (col, row): CellInit => {
    const group = Math.floor(col / GROUP);
    if (row >= ELEVATION_BAND_ROW) return { grass: 3, elevation: group * 2 };
    const band = bandAt(row);
    return band ? { [band.layer]: level(group) } : {};
  });
  const labels = [
    ...LEVEL_BANDS.flatMap(({ layer, row }) =>
      LEVEL_NAMES[layer].map((name, l) => ({ col: l * GROUP + 1, row, text: `${l} · ${name}` })),
    ),
    ...Array.from({ length: MAX_LEVEL + 1 }, (_, g) => ({
      col: g * GROUP + 1,
      row: ELEVATION_BAND_ROW,
      text: `height ${g * 2}`,
    })),
  ];
  return { grid, labels };
}

interface LandscapeShape {
  cols: number;
  rows: number;
  /** Raises the land so less of the map is sea. */
  land: number;
  /** Extra terraces added along ridge lines: 0 = rolling hills, 8 = a full range. */
  ridges: number;
}

/**
 * Natural terrain: sea around the edges, beaches, meadows and forest patches
 * inland, and relief that climbs along ridge lines. Forests stay below the
 * tree line and grass thins out toward the peaks.
 */
function landscape(seed: number, shape: LandscapeShape): CoverGrid {
  const { cols, rows, land, ridges } = shape;
  const noise = (s: number, x: number, y: number) =>
    fbm2D(x, y, { seed: seed * 7 + s, octaves: 4, persistence: 0.5, lacunarity: 2 });
  return createCoverGrid(cols, rows, (col, row): CellInit => {
    const nx = ((col + (row & 1) * 0.5) / (cols - 0.5)) * 2 - 1;
    const ny = (row / (rows - 1)) * 2 - 1;
    const e = noise(0, nx * 2.2, ny * 2.2) * 0.9 + (1 - Math.hypot(nx, ny)) * 0.8 - 0.45 + land;
    if (e < 0.3) {
      const water = e < 0.1 ? 4 : e < 0.18 ? 3 : e < 0.25 ? 2 : 1;
      return water >= 2 ? { water } : { water, grass: level(noise(1, nx * 3, ny * 3) * 2 - 0.5) };
    }
    const h = e - 0.3;
    const ridge = (1 - Math.abs(2 * noise(5, nx * 1.5 + 4, ny * 1.5) - 1)) ** 4;
    const elevation = clamp(Math.round(h * 7 + ridge * ridges * smoothstep(0.03, 0.2, h)), 0, MAX_ELEVATION);
    const grass = elevation >= 6 ? 0 : level(h * 9 + (noise(1, nx * 3, ny * 3) - 0.5) * 6 - Math.max(0, elevation - 3));
    const trees = h > 0.06 && elevation <= 4 ? level((noise(2, nx * 3.5, ny * 3.5) - 0.42) * 14 + h * 4) : 0;
    return { grass, trees, elevation };
  });
}

const island = (seed: number): DemoMap => ({ grid: landscape(seed, { cols: 22, rows: 16, land: 0.12, ridges: 2 }), labels: [] });

/**
 * Lowlands in front, then a ring of mountains around a high basin, with one
 * notch toward the valley and the tallest peaks behind it. Rain fills the
 * basin (priority-flood) up to the notch: a high lake that would spill into
 * the valley if it rose any further.
 */
function highlands(seed: number): DemoMap {
  const cols = 22;
  const rows = 16;
  const rng = mulberry32(seed * 977 + 13);
  const noise = (s: number, x: number, y: number) =>
    fbm2D(x, y, { seed: seed * 11 + s, octaves: 4, persistence: 0.5, lacunarity: 2 });
  const basin = { x: (rng() - 0.5) * 0.5, y: -0.35 + (rng() - 0.5) * 0.2 };
  const notch = Math.PI / 2 + (rng() - 0.5) * 1.2; // facing roughly toward the viewer
  const RING = 0.36;
  // A peak in the basin, across from the notch: an island while the lake is low.
  const away = notch + Math.PI + (rng() - 0.5) * 1.2;
  const knoll = { x: basin.x + (Math.cos(away) * RING * KNOLL.off) / 1.4, y: basin.y + Math.sin(away) * RING * KNOLL.off };

  const elevation: number[] = [];
  const cover: Partial<Cover>[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const nx = ((col + (row & 1) * 0.5) / (cols - 0.5)) * 2 - 1;
      const ny = (row / (rows - 1)) * 2 - 1;
      const land = noise(0, nx * 2, ny * 2) * 0.8 + (1 - Math.hypot(nx * 0.9, ny)) * 0.8 - 0.25;
      if (land < 0.3) {
        elevation.push(0);
        cover.push({ water: land < 0.12 ? 4 : land < 0.2 ? 3 : land < 0.26 ? 2 : 1 });
        continue;
      }
      const dx = (nx - basin.x) * 1.4;
      const dy = ny - basin.y;
      const d = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const off = Math.atan2(Math.sin(angle - notch), Math.cos(angle - notch)); // angular distance to the notch
      const notchDip = Math.exp(-(off * off) / 0.12);
      const backBoost = Math.max(0, -Math.sin(angle)) * 1.2;
      const ring = Math.exp(-(((d - RING) / 0.14) ** 2)) * (2.8 + backBoost - 2.2 * notchDip);
      const lowland = Math.min(3.2, (land - 0.3) * 6);
      const bowl = BOWL * (1 - Math.min(1, d / RING) ** 2);
      const floor = lowland + (5 - lowland) * smoothstep(RING + 0.14, RING - 0.04, d) - bowl; // the basin is a raised plateau, dished in the middle
      const peak = KNOLL.high * Math.exp(-((Math.hypot((nx - knoll.x) * 1.4, ny - knoll.y) / (KNOLL.width * RING)) ** 2));
      const e = clamp(floor + ring + peak + (noise(5, nx * 4, ny * 4) - 0.5) * 1.2, 0, MAX_ELEVATION);
      elevation.push(e);
      cover.push({
        grass: e >= 6 ? 0 : level((land - 0.3) * 8 + (noise(1, nx * 3, ny * 3) - 0.5) * 6 - Math.max(0, e - 3.5) * 2),
        trees: e <= 4.5 && d > RING + 0.1 ? level((noise(2, nx * 3.5, ny * 3.5) - 0.42) * 14 + (land - 0.3) * 4) : 0,
      });
    }
  }

  return { ...fillLakes(cols, rows, elevation, cover), labels: [] };
}

/**
 * A cell under `depth` steps of standing water: deeper than a third of a step
 * it is lake, flat at its level; shallower it is a damp, level shore.
 */
function floodCell(cover: Partial<Cover>, ground: number, depth: number): CellInit {
  if (depth > 0.35 && ground > 0) return { water: depth > 1.2 ? 4 : depth > 0.7 ? 3 : 2, elevation: ground + depth };
  if (depth > 0) return { ...cover, water: 1, elevation: ground + depth };
  return { ...cover, elevation: ground };
}

/** How far the middle of the highlands basin dips below its plateau (steps). */
const BOWL = 0.9;
/**
 * Peaks standing in basins: how high above the floor (steps), and their reach
 * and distance from the middle as shares of the basin's radius. Tall ones stay
 * islands; low ones go under when the lake is full and come up as it falls.
 */
const KNOLL = { high: 1.8, low: 1.1, width: 0.3, off: 0.3 };

/**
 * Let rain fill every basin (priority-flood). Lakes low in the land become
 * part of the map; the water of high basins is kept apart, over dry ground,
 * so it can be simulated.
 */
function fillLakes(cols: number, rows: number, elevation: number[], cover: Partial<Cover>[]): Required<Pick<DemoMap, 'grid' | 'water'>> {
  const waterLevel = fillDepressions({ cols, rows, elevation });
  const high = (i: number) => waterLevel[i] > elevation[i] && waterLevel[i] >= HIGH_LAKE_FROM;
  const water = elevation.map((e, i) => (high(i) ? waterLevel[i] - e : 0));
  const grid = createCoverGrid(cols, rows, (col, row) => {
    const i = row * cols + col;
    return floodCell(cover[i], elevation[i], high(i) ? 0 : waterLevel[i] - elevation[i]);
  });
  return { grid, water };
}

/** The map with its high basins filled with `water` (steps per cell), the way a static map shows lakes. */
export function floodedGrid(grid: CoverGrid, water: readonly number[] = []): CoverGrid {
  return createCoverGrid(grid.cols, grid.rows, (col, row) => {
    const i = row * grid.cols + col;
    return floodCell(grid.cells[i], grid.elevation[i], water[i] ?? 0);
  });
}

/** Map coordinates of a cell in [-1, 1], rows shifted as in the odd-r layout. */
const mapXY = (col: number, row: number, cols: number, rows: number) => [((col + (row & 1) * 0.5) / (cols - 0.5)) * 2 - 1, (row / (rows - 1)) * 2 - 1];

/** Floors of the basins stamped into the mountain map: from the foothills to high in the range. */
const BASIN_FLOORS = [2.5, 4, 5.5, 6.8];

/**
 * Random mountain country: ranges along ridged noise over rolling lowland,
 * with basins stamped in at very different heights, each a bowl held by a
 * rim with one low notch. Rain fills them (priority-flood), so lakes lie at
 * many levels, each overflowing through its notch.
 */
function mountains(seed: number): DemoMap {
  const [cols, rows] = [24, 18];
  const rng = mulberry32(seed * 131 + 7);
  const noise = (s: number, x: number, y: number) => fbm2D(x, y, { seed: seed * 13 + s, octaves: 4, persistence: 0.5, lacunarity: 2 });
  const landAt = (nx: number, ny: number) => noise(0, nx * 2, ny * 2) * 0.8 + (1 - Math.hypot(nx * 0.9, ny)) * 0.8 - 0.25;

  // Basins on land, apart from each other.
  const basins: { x: number; y: number; r: number; floor: number; notch: number }[] = [];
  for (const floor of BASIN_FLOORS) {
    for (let tries = 0; tries < 40; tries++) {
      const [x, y] = [rng() * 1.3 - 0.65, rng() * 1.1 - 0.55];
      if (landAt(x, y) < 0.5 || basins.some((b) => Math.hypot(b.x - x, b.y - y) < 0.5)) continue;
      basins.push({ x, y, r: 0.15 + rng() * 0.06, floor, notch: rng() * Math.PI * 2 });
      break;
    }
  }
  // A peak in each basin, across from its notch: every other one tall enough to stay an island.
  const knolls = basins.map((b, k) => {
    const away = b.notch + Math.PI + (rng() - 0.5);
    return { x: b.x + (Math.cos(away) * b.r * KNOLL.off) / 1.4, y: b.y + Math.sin(away) * b.r * KNOLL.off, h: k % 2 ? KNOLL.low : KNOLL.high };
  });

  const elevation: number[] = [];
  const cover: Partial<Cover>[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const [nx, ny] = mapXY(col, row, cols, rows);
      const land = landAt(nx, ny);
      if (land < 0.3) {
        elevation.push(0);
        cover.push({ water: land < 0.12 ? 4 : land < 0.2 ? 3 : land < 0.26 ? 2 : 1 });
        continue;
      }
      const lowland = Math.min(3, (land - 0.3) * 6);
      const ridge = (1 - Math.abs(2 * noise(5, nx * 1.6, ny * 1.6) - 1)) ** 2.5;
      const range = ridge * 5.5 * smoothstep(0.4, 0.62, noise(6, nx * 1.1, ny * 1.1));
      let e = lowland + range;
      basins.forEach((b, k) => {
        const d = Math.hypot((nx - b.x) * 1.4, ny - b.y) / b.r;
        const angle = Math.atan2(ny - b.y, (nx - b.x) * 1.4);
        const off = Math.atan2(Math.sin(angle - b.notch), Math.cos(angle - b.notch));
        const notch = Math.exp(-(off * off) / 0.15);
        const peak = knolls[k].h * Math.exp(-((Math.hypot((nx - knolls[k].x) * 1.4, ny - knolls[k].y) / (KNOLL.width * b.r)) ** 2));
        const bowl = d < 1 ? b.floor - 1.1 + 0.6 * d * d + peak : b.floor + (1.6 - 1.4 * notch) * Math.exp(-(((d - 1.3) / 0.45) ** 2));
        e += (bowl - e) * smoothstep(2.1, 1.5, d);
      });
      e = clamp(e + (noise(7, nx * 4, ny * 4) - 0.5) * 0.6, 0.3, MAX_ELEVATION);
      elevation.push(e);
      cover.push({
        grass: e >= 6 ? 0 : level((land - 0.3) * 8 + (noise(1, nx * 3, ny * 3) - 0.5) * 6 - Math.max(0, e - 3.5) * 2),
        trees: e <= 4.5 ? level((noise(2, nx * 3.5, ny * 3.5) - 0.42) * 14 + (land - 0.3) * 4 - Math.max(0, e - 3) * 2) : 0,
      });
    }
  }
  return { ...fillLakes(cols, rows, elevation, cover), labels: [] };
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
  { id: 'highlands', name: 'Highlands', build: highlands },
  { id: 'mountains', name: 'Mountains (random)', build: mountains },
  { id: 'random', name: 'Random mix', build: randomMix },
];

export function demoMap(id: string, seed: number): DemoMap {
  return (DEMO_MAPS.find((m) => m.id === id) ?? DEMO_MAPS[0]).build(seed);
}
