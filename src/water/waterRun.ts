import { restoreWorld, saveWorld, snapshot, type HydroSnapshot, type HydroWorld, type WorldState } from './hydroWorld';
import { scriptLength, stepScript, type WaterScript } from './waterScript';

/**
 * A model run played as it goes, instead of all at once up front: the
 * model steps forward only as far as asked, so playing starts at once and
 * each step costs one step of the model. Every `every` steps it keeps the
 * moment, so going back starts again from the nearest one before; it keeps
 * at most `keep` of them, dropping the oldest, so a run can go on forever.
 */
export interface Run<V> {
  /** Steps in the run (Infinity: it never ends). */
  readonly length: number;
  /** The earliest step it can still go back to. */
  readonly first: number;
  /** The model's view after `step` steps (clamped to what the run holds). */
  at(step: number): V;
  /** Moments kept to go back to. */
  readonly kept: number;
}

/** What a run steps: step `k` (from 0) in place, save and restore its state, and what a view needs of now. */
export interface Model<S, V> {
  step(k: number): void;
  save(): S;
  restore(state: S): void;
  view(): V;
}

export function createRun<S, V>(model: Model<S, V>, length = Infinity, every = 40, keep = Infinity): Run<V> {
  const kept = new Map<number, S>([[0, model.save()]]);
  let [now, first] = [0, 0];
  let last = { step: 0, view: model.view() };

  const goTo = (step: number) => {
    if (step < now) {
      const from = Math.floor(step / every) * every;
      model.restore(kept.get(from)!);
      now = from;
    }
    for (; now < step; ) {
      model.step(now++);
      if (now % every || kept.has(now)) continue;
      kept.set(now, model.save());
      if (kept.size <= keep) continue;
      kept.delete(first); // kept in the order made: oldest first
      first = kept.keys().next().value!;
    }
  };

  return {
    length,
    get first() {
      return first;
    },
    get kept() {
      return kept.size;
    },
    at(step) {
      const target = Math.max(first, Math.min(length, Math.round(step)));
      if (target !== last.step) {
        goTo(target);
        last = { step: target, view: model.view() };
      }
      return last.view;
    },
  };
}

/** A world run through a weather script. */
export const scriptModel = (world: HydroWorld, script: WaterScript): Model<WorldState, HydroSnapshot> => ({
  step: (k) => stepScript(world, script, k),
  save: () => saveWorld(world),
  restore: (state) => restoreWorld(world, state),
  view: () => snapshot(world),
});

export type WaterRun = Run<HydroSnapshot>;

export const createWaterRun = (world: HydroWorld, script: WaterScript, every = 40): WaterRun => createRun(scriptModel(world, script), scriptLength(script), every);
