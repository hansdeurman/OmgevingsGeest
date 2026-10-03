/// <reference lib="webworker" />
import { lakeBuffers, paintBasinLakes, type LakeSetup } from './lakeJob';
import type { LakeReply, LakeRequest } from './lakeSource';

/** Paints high lakes off the main thread: one setup per map, then one basin per request. */
let current: { id: number; setup: LakeSetup } | undefined;

self.onmessage = ({ data }: MessageEvent<LakeRequest>) => {
  if (data.type === 'setup') {
    current = { id: data.setupId, setup: data.setup };
    return;
  }
  if (data.setupId !== current?.id) return; // a map no longer shown
  const images = paintBasinLakes(current.setup, data.job);
  const reply: LakeReply = { setupId: data.setupId, jobId: data.jobId, basin: data.job.basin, images };
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(reply, lakeBuffers(images));
};
