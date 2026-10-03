/// <reference lib="webworker" />
import { paintBaseRows } from './groundComposer';
import type { BaseReply, BaseRequest, DetailReply, DetailRequest } from './basePool';
import { createTerrainSampler } from './terrainSampler';
import { groundDetail } from './wetGround';

/** Paints bands of a map's base terrain off the main thread, several workers side by side; or the ground's detail. */
self.onmessage = ({ data }: MessageEvent<BaseRequest | DetailRequest>) => {
  const post = (self as unknown as DedicatedWorkerGlobalScope).postMessage.bind(self);
  if ('scale' in data) {
    const detail = groundDetail(1, 512, data.scale);
    const reply: DetailReply = { id: data.id, detail };
    post(reply, [detail.puddle.buffer, detail.crack.buffer]);
    return;
  }
  const { id, job, band } = data;
  const { grid, textures, frame, size, seed, relief, blend } = job;
  const base = paintBaseRows(createTerrainSampler(grid, size, blend, seed), grid, textures, frame, size, seed, relief, band[0], band[1]);
  const reply: BaseReply = { id, base };
  const buffers = [base.ground.data, base.field, base.elevation, base.rows, base.lake, base.open].map((a) => a.buffer as ArrayBuffer);
  post(reply, buffers);
};
