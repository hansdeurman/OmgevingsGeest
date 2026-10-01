import type { Pixel } from '../math/hex';
import { shade, type RGB } from '../rendering/palette';
import { forEachCell, type CoverGrid } from './coverGrid';
import { frameCentre, gridFrame, isoSideFaces, toIso, type GridFrame, type IsoView } from './geometry';
import { composeGround } from './groundComposer';
import type { GroundTextures } from './placeholderTextures';
import { PROP_RULES, type PropRule } from './propRules';
import { getPixel, type Raster } from './raster';
import { scatterProps, type PropInstance } from './scatter';
import { createTerrainSampler } from './terrainSampler';

export interface SceneOptions {
  hexSize: number;
  seed: number;
  /** Width of the blend between neighbouring hexes, in hex radii. */
  blend: number;
  view: IsoView;
  rules?: readonly PropRule[];
}

export interface SideFace {
  points: Pixel[];
  color: RGB;
}

/**
 * Everything needed to draw a map, in draw order: slab sides, then the
 * top-down ground (squashed by the renderer), then props back-to-front.
 * Pure data, so it can be built and tested without a canvas.
 */
export interface Scene {
  frame: GridFrame;
  view: IsoView;
  hexSize: number;
  ground: Raster;
  /** Hex centres in top-down frame pixels, row-major. */
  centres: Pixel[];
  sides: SideFace[];
  /** Props in iso pixels (bottom-centre anchor), sorted back to front. */
  props: PropInstance[];
}

/** Front faces take the colour of the ground just above them, lit from the left. */
function sideFaces(ground: Raster, centre: Pixel, size: number, view: IsoView): SideFace[] {
  const groundAt = (dx: number): RGB => {
    const x = Math.min(ground.width - 1, Math.max(0, Math.round(centre.x + dx * size)));
    const y = Math.min(ground.height - 1, Math.round(centre.y + 0.66 * size));
    const [r, g, b] = getPixel(ground, x, y);
    return [r, g, b];
  };
  const [left, right] = isoSideFaces(centre, size, view);
  return [
    { points: left, color: shade(groundAt(-0.4), 0.78) },
    { points: right, color: shade(groundAt(0.4), 0.6) },
  ];
}

export function buildScene(grid: CoverGrid, textures: GroundTextures, opts: SceneOptions): Scene {
  const { hexSize: size, seed, view } = opts;
  const frame = gridFrame(grid.cols, grid.rows, size);
  const terrain = createTerrainSampler(grid, size, opts.blend, seed);
  const ground = composeGround(terrain, textures, frame, size, seed);

  const centres: Pixel[] = [];
  forEachCell(grid, (_, col, row) => centres.push(frameCentre(col, row, size, frame)));

  const props = scatterProps(grid, terrain, opts.rules ?? PROP_RULES, size, seed)
    .map((p) => ({ ...p, ...toIso({ x: p.x + frame.ox, y: p.y + frame.oy }, view) }))
    .sort((a, b) => a.y - b.y);

  return {
    frame,
    view,
    hexSize: size,
    ground,
    centres,
    sides: centres.flatMap((c) => sideFaces(ground, c, size, view)),
    props,
  };
}
