import { ref } from 'vue';
import type { World } from './world/World';
import type { AirFlowSimulation } from './airflow/AirFlowSimulation';
import {
  addSource,
  clearSources,
  clearSinks,
  clearBursts,
} from './airflow';
import { offsetToPixel, pixelToOffset, hexCorners } from './math/hex';
import { config, gridDimensions, HEX_PIXEL_SIZE } from './config/parameters';

/**
 * A named pre-built test environment: terrain shape + a few starter sources.
 * Picked on first mount and switchable from the dev panel; each scenario is
 * responsible for resetting world heights, corner heights, and any existing
 * sources/sinks before painting its own setup.
 */
export interface TestScenario {
  id: string;
  name: string;
  apply(world: World, airFlow: AirFlowSimulation): void;
}

/** Reset the world's terrain + airflow state to a clean slate. */
function clearWorld(world: World, airFlow: AirFlowSimulation): void {
  clearSources();
  clearSinks();
  clearBursts();
  airFlow.clearField();
  for (const tile of world.tiles) {
    tile.height = 0;
    tile.cornerHeights = undefined;
  }
}

/**
 * Sample a rectangular wall in pixel space. Plateau of `halfWidth` x
 * `halfLen`, gaussian taper of `taperPerp` perpendicular and `taperEnd`
 * along the axis. Returns the normalised height in [0, 1].
 */
function sampleAxisAlignedWall(
  px: number,
  py: number,
  centre: { x: number; y: number },
  orientation: 'vertical' | 'horizontal',
  halfWidth: number,
  halfLen: number,
  taperPerp: number,
  taperEnd: number,
): number {
  let dPerp: number;
  let dAlong: number;
  if (orientation === 'vertical') {
    dPerp = Math.abs(px - centre.x);
    dAlong = Math.abs(py - centre.y);
  } else {
    dPerp = Math.abs(py - centre.y);
    dAlong = Math.abs(px - centre.x);
  }
  const perp = dPerp <= halfWidth
    ? 1
    : Math.exp(-((dPerp - halfWidth) ** 2) / (2 * taperPerp * taperPerp));
  const along = dAlong <= halfLen
    ? 1
    : Math.exp(-((dAlong - halfLen) ** 2) / (2 * taperEnd * taperEnd));
  return perp * along;
}

/**
 * For every cell in the world, sample the height function at the cell
 * centre AND at every corner. Heights are accumulated with Math.max so
 * adding multiple features (wall + mountain + wall + …) layers cleanly.
 */
function paintTerrain(
  world: World,
  sample: (px: number, py: number) => number,
): void {
  const width = world.width;
  const height = world.height;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const pos = offsetToPixel(c, r, HEX_PIXEL_SIZE);
      const idx = r * width + c;
      const tile = world.tiles[idx];
      const centreH = sample(pos.x, pos.y);
      if (centreH > tile.height) tile.height = centreH;
      const corners = hexCorners(pos.x, pos.y, HEX_PIXEL_SIZE);
      const ch = tile.cornerHeights ?? new Float32Array(6);
      for (let i = 0; i < 6; i++) {
        const s = sample(corners[i].x, corners[i].y);
        if (s > ch[i]) ch[i] = s;
      }
      tile.cornerHeights = ch;
    }
  }
}

/**
 * Plant N outward-firing burst sources in a ring around the map centre,
 * every (360 / N)°. Defaults give a 12-source ring at radius 5 hexes.
 */
function ringOfSources(world: World, count: number, radiusHexes: number): void {
  const cx = Math.floor(world.width / 2);
  const cy = Math.floor(world.height / 2);
  const centerPx = offsetToPixel(cx, cy, HEX_PIXEL_SIZE);
  const radiusPx = radiusHexes * Math.sqrt(3) * HEX_PIXEL_SIZE;
  const placed = new Set<number>();
  for (let i = 0; i < count; i++) {
    const angle = (i * 2 * Math.PI) / count;
    const tx = centerPx.x + radiusPx * Math.cos(angle);
    const ty = centerPx.y + radiusPx * Math.sin(angle);
    const cell = pixelToOffset(tx, ty, HEX_PIXEL_SIZE);
    if (cell.col < 0 || cell.col >= world.width || cell.row < 0 || cell.row >= world.height) continue;
    const idx = cell.row * world.width + cell.col;
    if (placed.has(idx)) continue;
    placed.add(idx);
    addSource({
      col: cell.col,
      row: cell.row,
      vx: Math.cos(angle) * config.placeSpeed,
      vy: Math.sin(angle) * config.placeSpeed,
      density: config.placeDensity,
      duration: config.placeOnTime,
      period: config.placePeriod,
    });
  }
}

/** ---------- Scenario 1: Wall vs Conical Peak ---------- */

function applyWallAndPeak(world: World, airFlow: AirFlowSimulation): void {
  clearWorld(world, airFlow);
  airFlow.setBaseline(config.windDensityBaseline);

  const { width, height } = gridDimensions(config.hexCount);
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);

  const wallCentre = offsetToPixel(cx + 10, cy, HEX_PIXEL_SIZE);
  const wallHalfWidth = HEX_PIXEL_SIZE * 1.0;
  const wallTaperPerp = HEX_PIXEL_SIZE * 0.5;
  const wallHalfLen = 4 * HEX_PIXEL_SIZE * 1.5;
  const wallEndSigma = HEX_PIXEL_SIZE * 1.5;

  const mtnCentre = offsetToPixel(cx - 10, cy, HEX_PIXEL_SIZE);
  const mtnSigma = HEX_PIXEL_SIZE * 2.2;

  paintTerrain(world, (px, py) => {
    const wallH = sampleAxisAlignedWall(
      px, py, wallCentre, 'vertical',
      wallHalfWidth, wallHalfLen, wallTaperPerp, wallEndSigma,
    );
    const mdx = px - mtnCentre.x;
    const mdy = py - mtnCentre.y;
    const mtnH = Math.exp(-(mdx * mdx + mdy * mdy) / (2 * mtnSigma * mtnSigma));
    return Math.max(wallH, mtnH);
  });

  ringOfSources(world, 12, 5);
}

/** ---------- Scenario 2: L-Wall Labyrinth ---------- */

interface LWall {
  /** Inner-corner pixel position (the meeting point of the two arms). */
  corner: { x: number; y: number };
  /** Vertical-arm length in pixels (extends UP from corner: corner.y - len .. corner.y). */
  vertLen: number;
  /** Horizontal-arm length in pixels (extends RIGHT from corner: corner.x .. corner.x + len). */
  horizLen: number;
  /** Half-width perpendicular to each arm, in pixels. */
  halfWidth: number;
  /** Peak height. */
  peak: number;
  /** Perpendicular gaussian taper σ outside the plateau, in pixels. */
  taperPerp: number;
  /** Gaussian taper σ at the open ends of each arm, in pixels. */
  taperEnd: number;
}

function sampleLWall(px: number, py: number, l: LWall): number {
  // Vertical arm: centre at corner.x, runs from corner.y - vertLen to corner.y.
  const vCentreY = l.corner.y - l.vertLen * 0.5;
  const v = sampleAxisAlignedWall(
    px, py,
    { x: l.corner.x, y: vCentreY },
    'vertical',
    l.halfWidth, l.vertLen * 0.5, l.taperPerp, l.taperEnd,
  );
  // Horizontal arm: centre at corner.y, runs from corner.x to corner.x + horizLen.
  const hCentreX = l.corner.x + l.horizLen * 0.5;
  const h = sampleAxisAlignedWall(
    px, py,
    { x: hCentreX, y: l.corner.y },
    'horizontal',
    l.halfWidth, l.horizLen * 0.5, l.taperPerp, l.taperEnd,
  );
  return Math.max(v, h) * l.peak;
}

function applyLWallLabyrinth(world: World, airFlow: AirFlowSimulation): void {
  clearWorld(world, airFlow);
  airFlow.setBaseline(config.windDensityBaseline);

  const { width, height } = gridDimensions(config.hexCount);
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const hex = HEX_PIXEL_SIZE;

  // Four L-walls of different size / height / thickness, scattered around
  // the centre. Pixel offsets are in hex-row spacing units (1.5 * hex) for
  // y and √3 * hex for x so each L sits cleanly in the grid.
  const rowY = 1.5 * hex;
  const colX = Math.sqrt(3) * hex;

  const ls: LWall[] = [
    // Upper-left: tall thin L pointing toward map centre.
    {
      corner: offsetToPixel(cx - 8, cy - 6, hex),
      vertLen: 8 * rowY,
      horizLen: 5 * colX,
      halfWidth: hex * 0.9,
      peak: 1.0,
      taperPerp: hex * 0.5,
      taperEnd: hex * 1.0,
    },
    // Upper-right: medium L, thicker walls.
    {
      corner: offsetToPixel(cx + 5, cy - 8, hex),
      vertLen: 6 * rowY,
      horizLen: 4 * colX,
      halfWidth: hex * 1.5,
      peak: 0.7,
      taperPerp: hex * 0.6,
      taperEnd: hex * 1.0,
    },
    // Lower-left: short low-profile L.
    {
      corner: offsetToPixel(cx - 6, cy + 8, hex),
      vertLen: 5 * rowY,
      horizLen: 6 * colX,
      halfWidth: hex * 0.7,
      peak: 0.5,
      taperPerp: hex * 0.4,
      taperEnd: hex * 0.8,
    },
    // Lower-right: chunky, full-height L.
    {
      corner: offsetToPixel(cx + 9, cy + 7, hex),
      vertLen: 4 * rowY,
      horizLen: 5 * colX,
      halfWidth: hex * 1.2,
      peak: 0.95,
      taperPerp: hex * 0.6,
      taperEnd: hex * 1.0,
    },
  ];

  paintTerrain(world, (px, py) => {
    let h = 0;
    for (const l of ls) {
      const v = sampleLWall(px, py, l);
      if (v > h) h = v;
    }
    return h;
  });

  // Pair of opposing continuous sources at the map edges, blowing across
  // the labyrinth so the player can immediately see how flow gets steered
  // by the L-corners.
  const westEdgePx = offsetToPixel(2, cy, hex);
  const westCell = pixelToOffset(westEdgePx.x, westEdgePx.y, hex);
  addSource({
    col: westCell.col,
    row: westCell.row,
    vx: config.placeSpeed,
    vy: 0,
    density: config.placeDensity,
  });

  const eastEdgePx = offsetToPixel(width - 3, cy, hex);
  const eastCell = pixelToOffset(eastEdgePx.x, eastEdgePx.y, hex);
  addSource({
    col: eastCell.col,
    row: eastCell.row,
    vx: -config.placeSpeed,
    vy: 0,
    density: config.placeDensity,
  });
}

/** ---------- Scenario: Empty Field ---------- */

/**
 * No terrain. Three periodic burst sources spaced 120° around the map
 * centre, each firing in its own direction so the flow has to be driven
 * purely by the sources and ambient dynamics — handy for spotting
 * terrain-free behaviour (anisotropy, dispersion, V↔ρ coupling).
 */
function applyEmptyField(world: World, airFlow: AirFlowSimulation): void {
  clearWorld(world, airFlow);
  airFlow.setBaseline(config.windDensityBaseline);

  const { width, height } = gridDimensions(config.hexCount);
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const centerPx = offsetToPixel(cx, cy, HEX_PIXEL_SIZE);
  const radiusPx = 10 * Math.sqrt(3) * HEX_PIXEL_SIZE;

  // Each source sits 120° around the centre and fires outward (i.e. its
  // emission direction matches its position angle). Different angles
  // produce different incoming-edge alignments so we can spot any
  // residual hex-axis bias from a single picture.
  for (let i = 0; i < 3; i++) {
    const angle = (i * 2 * Math.PI) / 3;
    const tx = centerPx.x + radiusPx * Math.cos(angle);
    const ty = centerPx.y + radiusPx * Math.sin(angle);
    const cell = pixelToOffset(tx, ty, HEX_PIXEL_SIZE);
    if (cell.col < 0 || cell.col >= world.width || cell.row < 0 || cell.row >= world.height) continue;
    addSource({
      col: cell.col,
      row: cell.row,
      vx: Math.cos(angle) * config.placeSpeed,
      vy: Math.sin(angle) * config.placeSpeed,
      density: config.placeDensity,
      duration: config.placeOnTime,
      period: config.placePeriod,
    });
  }
}

/** ---------- Registry ---------- */

export const SCENARIOS: ReadonlyArray<TestScenario> = [
  { id: 'emptyField', name: 'Empty Field', apply: applyEmptyField },
  { id: 'wallAndPeak', name: 'Wall vs Conical Peak', apply: applyWallAndPeak },
  { id: 'lWallLabyrinth', name: 'L-Wall Labyrinth', apply: applyLWallLabyrinth },
];

export const DEFAULT_SCENARIO_ID = SCENARIOS[0].id;

/** Reactive: which scenario is currently shown. DevPanel binds a select to this. */
export const currentScenarioId = ref<string>(DEFAULT_SCENARIO_ID);

/** Apply a scenario by id. Returns false if no scenario matches. */
export function applyScenario(id: string, world: World, airFlow: AirFlowSimulation): boolean {
  const scenario = SCENARIOS.find((s) => s.id === id);
  if (!scenario) return false;
  scenario.apply(world, airFlow);
  return true;
}
