import type { CoverGrid } from './coverGrid';
import type { GridFrame } from './geometry';
import { joinBases, type BaseTerrain } from './groundComposer';
import type { GroundTextures } from './placeholderTextures';
import type { ReliefOptions } from './relief';
import type { GroundDetail } from './wetGround';

/** Bands per painter: smaller bands even out rows that cost more (land) and less (sea). */
const BANDS_PER_PAINTER = 3;

/** Frame rows [0, height) cut into `count` bands of about equal height, top to bottom. */
export function bandsOf(height: number, count: number): [number, number][] {
  const n = Math.max(1, Math.min(count, height));
  return Array.from({ length: n }, (_, k) => [Math.round((k * height) / n), Math.round(((k + 1) * height) / n)]);
}

/**
 * The base terrain of `height` rows, painted band by band by `painters`
 * side by side (each takes the next band as it finishes one), joined.
 */
export async function paintInBands(height: number, painters: number, paint: (band: [number, number], painter: number) => Promise<BaseTerrain>): Promise<BaseTerrain> {
  const bands = bandsOf(height, painters * BANDS_PER_PAINTER);
  const done: BaseTerrain[] = [];
  let next = 0;
  const work = async (painter: number) => {
    for (let k = next++; k < bands.length; k = next++) done[k] = await paint(bands[k], painter);
  };
  await Promise.all(Array.from({ length: painters }, (_, p) => work(p)));
  return joinBases(done);
}

/** What painting a map's base terrain needs: all plain data, to hand to workers. */
export interface BaseJob {
  grid: CoverGrid;
  textures: GroundTextures;
  frame: GridFrame;
  size: number;
  seed: number;
  relief: ReliefOptions;
  /** Width of the blend between neighbouring hexes, in hex radii. */
  blend: number;
}

export interface BaseRequest {
  id: number;
  job: BaseJob;
  band: [number, number];
}

export interface BaseReply {
  id: number;
  base: BaseTerrain;
}

/** The ground's detail at `scale` times the art's size, from a worker. */
export interface DetailRequest {
  id: number;
  scale: number;
}

export interface DetailReply {
  id: number;
  detail: GroundDetail;
}

/** Paint base terrains (and the ground's detail) with `workers` running baseWorker, each painting a band at a time. */
export function workerPainters(workers: readonly Worker[]) {
  let id = 0;
  const waiting = new Map<number, (reply: BaseReply | DetailReply) => void>();
  for (const w of workers) w.onmessage = ({ data }: MessageEvent<BaseReply | DetailReply>) => waiting.get(data.id)?.(data);
  const ask = <R>(worker: number, request: BaseRequest | DetailRequest, pick: (reply: BaseReply | DetailReply) => R) =>
    new Promise<R>((resolve) => {
      waiting.set(request.id, (reply) => (waiting.delete(request.id), resolve(pick(reply))));
      workers[worker].postMessage(request);
    });
  return {
    base: (job: BaseJob) => paintInBands(job.frame.height, workers.length, (band, painter) => ask(painter, { id: ++id, job, band }, (r) => (r as BaseReply).base)),
    detail: (scale: number) => ask(0, { id: ++id, scale }, (r) => (r as DetailReply).detail),
  };
}
