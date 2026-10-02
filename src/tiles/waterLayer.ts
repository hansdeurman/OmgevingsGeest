import { pixelToOffset, type Pixel } from '../math/hex';
import { neighbourIndices } from './hydrology';
import { smoothstep } from '../math/scalar';
import { basins } from '../water/waterScript';
import { frameCentre, type GridFrame } from './geometry';
import type { Overflow } from './highLakes';
import type { ElevationMap } from './hydrology';
import type { River } from './rivers';
import type { PropInstance } from './scatter';
import { lakeLift, lakeShapes, type LakeShape } from './shores';

/**
 * From water per hex (a simulation's state) to lakes per pixel. The water's
 * surface and the ground are both blended smoothly across hexes; wherever the
 * surface stands above the ground there is water, so shores follow the lie of
 * the land, a falling lake shrinks into its deepest spots, peaks poke through
 * as islands, and a lake that has not levelled out yet keeps its slope.
 */

/** A high basin: its cells, the level at which it overflows, and where. */
export interface Basin {
  cells: number[];
  /** The land around it that stands above its overflow level: its shores may run up onto it. */
  shore: number[];
  full: number;
  /** Frame pixels around its cells and shore: [x0, x1) × [y0, y1). */
  box: { x0: number; y0: number; x1: number; y1: number };
  /** Where it pours out (frame px), between its last cell and the cell below. */
  outlet?: Pixel;
}

/** Ground and the water standing on it, per cell (steps). */
export interface CellWater {
  cols: number;
  rows: number;
  ground: ArrayLike<number>;
  depth: ArrayLike<number>;
}

/** A lake in a basin, and how it overflows. */
export interface BasinLake {
  shape: LakeShape;
  overflow: Overflow;
}

/** Width of the blend between neighbouring hexes' water and ground, in hex radii. */
const BLEND = 0.6;
/** Water (steps) on a cell from which it starts to count as lake, and fully: thinner films run off and are not drawn. */
const WET: [number, number] = [0.04, 0.12];
/** A pixel is under water when the surface stands this far (steps) above its ground. */
const MIN_DEPTH = 0.04;
/** Side of the smallest lake drawn, in hex radii: smaller puddles are left out. */
const MIN_LAKE = 0.6;
/** How far from the middle of its nearest cell (hex radii) a basin's water may reach: up the slope of the land around it, never over its crest. */
const REACH = 1.25;
/** Land around a basin this little (steps) below its overflow level still holds its shore; lower land is where it pours out. */
const SPILL_EDGE = 0.05;
/** A mountain sprite still shows while it stands this far (steps) above the water. */
const PEAK_SHOWS = 0.25;

/** The high basins of a map, given the water (steps per cell) that fills each one. */
export function findBasins(map: ElevationMap, full: ArrayLike<number>, rivers: readonly River[], frame: GridFrame, size: number): Basin[] {
  const centre = (i: number) => frameCentre(i % map.cols, Math.floor(i / map.cols), size, frame);
  const clampX = (x: number) => Math.max(0, Math.min(frame.width, Math.round(x)));
  const clampY = (y: number) => Math.max(0, Math.min(frame.height, Math.round(y)));
  return basins(map.cols, map.rows, full).map((cells) => {
    const level = Math.max(...cells.map((i) => map.elevation[i] + full[i]));
    const shore = [...new Set(cells.flatMap((i) => neighbourIndices(map, i)))].filter((j) => !cells.includes(j) && map.elevation[j] >= level - SPILL_EDGE);
    const around = [...cells, ...shore];
    const [xs, ys] = [around.map((i) => centre(i).x), around.map((i) => centre(i).y)];
    const box = {
      x0: clampX(Math.min(...xs) - size),
      y0: clampY(Math.min(...ys) - size),
      x1: clampX(Math.max(...xs) + size),
      y1: clampY(Math.max(...ys) + size),
    };
    const river = rivers.find((r) => cells.includes(r.cells[0]));
    const [a, b] = river ? [centre(river.cells[0]), centre(river.outlet[1])] : [];
    return {
      cells,
      shore,
      full: level,
      box,
      outlet: a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : undefined,
    };
  });
}

/**
 * Per pixel of a basin's box: the water's surface where it stands above the
 * ground (NaN where dry), the ground's elevation, both in steps, and whether
 * the pixel lies in the basin itself (1) rather than on the land around it.
 */
export function basinWater(basin: Basin, water: CellWater, frame: GridFrame, size: number) {
  const { x0, y0, x1, y1 } = basin.box;
  const [width, height] = [x1 - x0, y1 - y0];
  const levels = new Float32Array(width * height).fill(NaN);
  const ground = new Float32Array(width * height).fill(NaN);
  const own = new Uint8Array(width * height);
  const inBasin = new Set(basin.cells);
  const invSigma2 = 1 / (BLEND * size) ** 2;
  const reach2 = (REACH * size) ** 2;
  // Per cell, once: its centre, how wet it is, and the cells blended around it (itself first).
  // Only the basin's own water makes its lake: what stands on the land around it is running off.
  const map = { cols: water.cols, rows: water.rows, elevation: [] };
  const centre = (i: number) => frameCentre(i % water.cols, Math.floor(i / water.cols), size, frame);
  const blended = (j: number) => ({ j, at: centre(j), own: inBasin.has(j), wet: inBasin.has(j) ? smoothstep(WET[0], WET[1], water.depth[j]) : 0 });
  const around = new Map([...basin.cells, ...basin.shore].map((i) => [i, [i, ...neighbourIndices(map, i)].map(blended)]));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [px, py] = [x0 + x + 0.5, y0 + y + 0.5];
      const hex = pixelToOffset(px - frame.ox, py - frame.oy, size);
      const cell = hex.row * water.cols + hex.col;
      const cells = around.get(cell);
      if (!cells) continue;
      let g = 0;
      let gw = 0;
      let s = 0;
      let sw = 0;
      let near = Infinity;
      for (const { j, at, own, wet } of cells) {
        const d2 = (px - at.x) ** 2 + (py - at.y) ** 2;
        const w = Math.exp(-d2 * invSigma2);
        if (own && d2 < near) near = d2;
        g += w * water.ground[j];
        gw += w;
        s += w * wet * (water.ground[j] + water.depth[j]);
        sw += w * wet;
      }
      const i = y * width + x;
      own[i] = inBasin.has(cell) ? 1 : 0;
      ground[i] = g / gw;
      if (sw > 1e-9 && near <= reach2 && s / sw - ground[i] > MIN_DEPTH) levels[i] = s / sw;
    }
  }
  return { levels, ground, own, width, height };
}

/**
 * The lakes standing in a basin now, in frame pixels, each told where its
 * basin overflows. Water standing only on the land around it (a basin
 * overflowing onto a flat rim) runs off and is not a lake.
 */
export function lakesIn(basin: Basin, water: CellWater, frame: GridFrame, size: number): BasinLake[] {
  const { levels, ground, own, width, height } = basinWater(basin, water, frame, size);
  const inBasin = (s: LakeShape) => s.mask.some((m, i) => m === 1 && own[(s.y0 + Math.floor(i / s.width)) * width + s.x0 + (i % s.width)]);
  return lakeShapes(levels, width, height, (MIN_LAKE * size) ** 2, ground).filter(inBasin).map((shape) => ({
    shape: { ...shape, x0: shape.x0 + basin.box.x0, y0: shape.y0 + basin.box.y0 },
    overflow: { full: basin.full, outlet: basin.outlet },
  }));
}

/**
 * Props (scene px, on the flat map) where lakes are: under water they are
 * hidden, unless they are mountains that still rise above it; those, and
 * whatever stands on an island, ride on their lake, lifted to its height.
 */
export function settleProps(props: readonly PropInstance[], shapes: readonly LakeShape[], squash: number, size: number) {
  const kept: PropInstance[] = [];
  const riders: PropInstance[][] = shapes.map(() => []);
  for (const p of props) {
    const [fx, fy] = [Math.floor(p.x), Math.floor(p.y / squash)];
    const k = shapes.findIndex((s) => fx >= s.x0 && fy >= s.y0 && fx < s.x0 + s.width && fy < s.y0 + s.height && s.mask[(fy - s.y0) * s.width + fx - s.x0]);
    if (k < 0) {
      kept.push(p);
      continue;
    }
    const s = shapes[k];
    const i = (fy - s.y0) * s.width + fx - s.x0;
    const above = s.mask[i] === 2 || (p.elevation ?? -Infinity) - PEAK_SHOWS > s.levels[i];
    if (above) riders[k].push({ ...p, y: p.y - lakeLift(s.levels[i]) * size });
  }
  return { kept, riders };
}
