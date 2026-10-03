import { restoreWorld, saveWorld, snapshot, type HydroSnapshot, type HydroWorld, type WorldState } from './hydroWorld';
import { scriptLength, stepScript, type WaterScript } from './waterScript';

/**
 * A scripted water run played as it goes, instead of all at once up front:
 * the world steps forward only as far as asked, so playing starts at once
 * and each step costs one step of the model. Every `every` steps it keeps
 * the moment, so going back starts again from the nearest one before.
 */
export interface WaterRun {
  /** Steps in the script. */
  readonly length: number;
  /** The water after `step` steps (the end past it). */
  at(step: number): HydroSnapshot;
  /** Moments kept to go back to. */
  readonly kept: number;
}

export function createWaterRun(world: HydroWorld, script: WaterScript, every = 40): WaterRun {
  const length = scriptLength(script);
  const kept = new Map<number, WorldState>([[0, saveWorld(world)]]);
  let now = 0;
  let last = { step: 0, state: snapshot(world) };

  const goTo = (step: number) => {
    if (step < now) {
      const from = Math.floor(step / every) * every;
      restoreWorld(world, kept.get(from)!);
      now = from;
    }
    for (; now < step; ) {
      stepScript(world, script, now++);
      if (now % every === 0 && !kept.has(now)) kept.set(now, saveWorld(world));
    }
  };

  return {
    length,
    get kept() {
      return kept.size;
    },
    at(step) {
      const target = Math.max(0, Math.min(length, Math.round(step)));
      if (target !== last.step) {
        goTo(target);
        last = { step: target, state: snapshot(world) };
      }
      return last.state;
    },
  };
}
