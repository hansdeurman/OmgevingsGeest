import { hexTopology } from '../water/hexTopology';
import type { GridFrame } from './geometry';
import { lakeArt, lakeState, type LakeKit, type Weather } from './highLakes';
import { paintLake, type LakeImage } from './lakePainter';
import type { GroundTextures } from './placeholderTextures';
import type { Raster } from './raster';
import { fullOutflow, lakeOutflow, lakesIn, type Basin } from './waterLayer';

/**
 * Painting the lakes of one high basin, as a job: everything it needs is
 * plain data (no functions), so it can run here or in a worker alike.
 */

/** What stays the same while the water runs: the map, its basins and the art. */
export interface LakeSetup {
  cols: number;
  rows: number;
  frame: GridFrame;
  size: number;
  squash: number;
  basins: Basin[];
  kit: LakeKit;
  /** Ground art for the lakes' rims. */
  rims: Pick<GroundTextures, 'snow' | 'rock'>;
  /** The land under the water, on islands and flanks, in frame pixels. */
  floor: Raster;
}

/** The water in one basin now. */
export interface LakeJob {
  basin: number;
  depth: ArrayLike<number>;
  ground: ArrayLike<number>;
  /** Flow per pipe, and pipes per hex, if a water model runs: where the lakes pour out. */
  flux?: Float32Array;
  dirs?: 6 | 12;
  weather: Weather;
}

export function paintBasinLakes(setup: LakeSetup, job: LakeJob): LakeImage[] {
  const { cols, rows, frame, size, squash, kit, rims, floor } = setup;
  const basin = setup.basins[job.basin];
  const topo = job.flux && hexTopology(cols, rows, job.dirs ?? 12);
  return lakesIn(basin, { cols, rows, ground: job.ground, depth: job.depth }, frame, size).map(({ shape }) => {
    const outflow = topo ? lakeOutflow(shape, topo, job.flux!, frame, size) : fullOutflow(shape, basin);
    return paintLake(shape, lakeState(shape, job.weather, outflow), { ...lakeArt(kit, shape.level, rims), floor }, squash, size);
  });
}

/** The arrays a painted lake holds, to hand it over without copying. */
export const lakeBuffers = (images: readonly LakeImage[]): ArrayBuffer[] =>
  images.flatMap((l) => [l.raster.data.buffer, l.surface.lift.buffer, l.surface.kind.buffer, l.surface.level.buffer] as ArrayBuffer[]);

