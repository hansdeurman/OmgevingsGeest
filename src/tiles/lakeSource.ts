import { paintBasinLakes, type LakeJob, type LakeSetup } from './lakeJob';
import type { LakeImage } from './lakePainter';
import { createSettleCache } from './settleCache';

/**
 * Where a scene gets its basins' lake paintings from. `settled` are the
 * values that decide whether a painting is still good (the basin's water);
 * `tag` what must match exactly (the weather).
 */
export type LakeSource = (setup: LakeSetup, job: LakeJob, settled: ArrayLike<number>, tag: string) => LakeImage[];

/** Paints right away, keeping each basin's painting while its water stays within `tolerance` of what it was painted for. */
export function syncLakes(tolerance: number, paint = paintBasinLakes): LakeSource {
  const cache = createSettleCache<string, LakeImage[]>(tolerance);
  const ids = new WeakMap<LakeSetup, number>();
  let count = 0;
  return (setup, job, settled, tag) => {
    if (!ids.has(setup)) ids.set(setup, ++count);
    return cache(`${ids.get(setup)}:${job.basin}`, settled, tag, () => paint(setup, job));
  };
}

/** What goes to the painting worker. */
export type LakeRequest = { type: 'setup'; setupId: number; setup: LakeSetup } | { type: 'paint'; setupId: number; jobId: number; job: LakeJob };
/** What comes back. */
export interface LakeReply {
  setupId: number;
  jobId: number;
  basin: number;
  images: LakeImage[];
}

interface Wanted {
  job: LakeJob;
  settled: Float32Array;
  tag: string;
}

interface BasinState {
  images: LakeImage[];
  /** What the images show, and what is being painted now. */
  shown?: Wanted;
  painting?: Wanted;
  /** The water as last asked for, while a painting is on its way. */
  next?: Wanted;
}

/**
 * Paints in a worker, so the frame never waits for it: a basin shows its
 * latest painting (none at first) and, once its water has changed visibly,
 * a new one is asked for; one at a time per basin, always for the latest
 * water. `post` sends to the worker; `onPainted` is told when a painting
 * comes in, so the view can show it; `receive` takes the worker's replies.
 */
export function asyncLakes(post: (request: LakeRequest) => void, onPainted: () => void, tolerance: number) {
  let current: LakeSetup | undefined;
  let setupId = 0;
  let jobId = 0;
  let basins = new Map<number, BasinState>();

  const differs = (a: Wanted | undefined, b: Wanted) =>
    !a || a.tag !== b.tag || a.settled.length !== b.settled.length || a.settled.some((v, i) => Math.abs(v - b.settled[i]) > tolerance);
  const send = (state: BasinState, wanted: Wanted) => {
    state.painting = wanted;
    state.next = undefined;
    post({ type: 'paint', setupId, jobId: ++jobId, job: wanted.job });
  };

  const source: LakeSource = (setup, job, settled, tag) => {
    if (setup !== current) {
      current = setup;
      basins = new Map();
      post({ type: 'setup', setupId: ++setupId, setup });
    }
    const state = basins.get(job.basin) ?? basins.set(job.basin, { images: [] }).get(job.basin)!;
    const wanted = { job, settled: Float32Array.from(settled), tag };
    if (differs(state.painting ?? state.shown, wanted)) {
      if (state.painting) state.next = wanted;
      else send(state, wanted);
    }
    return state.images;
  };

  const receive = (reply: LakeReply) => {
    const state = reply.setupId === setupId ? basins.get(reply.basin) : undefined;
    if (!state?.painting) return;
    [state.images, state.shown, state.painting] = [reply.images, state.painting, undefined];
    if (state.next && differs(state.shown, state.next)) send(state, state.next);
    onPainted();
  };

  return { source, receive };
}
