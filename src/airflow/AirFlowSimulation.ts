import type { World } from '../world/World';
import { offsetNeighbours, NEIGHBOUR_DIRS } from '../math/hex';
import { WindField } from './WindField';

/**
 * Tunable inputs for one simulation step.
 * Damping and coupling are *rates* (per second), not per-step factors, so the
 * sim behaves consistently regardless of frame rate.
 */
export interface AirFlowParams {
  /** Background wind speed applied uniformly across the map. */
  ambientSpeed: number;
  /** Background wind direction in radians (0 = +x, π/2 = +y / down). */
  ambientDirection: number;
  /** Linear drag rate (per second). Higher = faster decay toward steady state. */
  damping: number;
  /** Strength of terrain pushback per unit of normalised height delta. */
  terrainCoupling: number;
  /** Higher values let fast wind ignore terrain (flow over instead of around). */
  overcomeFactor: number;
  /** Hard cap on wind speed; prevents any single cell from exploding. */
  maxSpeed: number;
  /** 0..1 blend with neighbour-average per step; gentle visual smoothing. */
  smoothing: number;
}

/**
 * Hexagonal air-flow simulation.
 *
 * Each step:
 *   1. Apply ambient force.
 *   2. For each uphill neighbour the wind is heading toward, push back with
 *      a force proportional to the height delta and inversely modulated by
 *      the wind's current speed (the "overcome" term — fast wind ignores
 *      terrain more than slow wind).
 *   3. Damp via first-order rate.
 *   4. Optionally blend with the 6-neighbour velocity average.
 *
 * Stability tricks (the user warned us about cliff edges):
 *   - Heights are pre-smoothed with a 1-ring box blur so gradients sampled
 *     from `smoothedHeight` don't spike at sharp cliffs.
 *   - The terrain term is *direction-gated* (only fires when v · d > 0), so a
 *     cell sitting next to a tall neighbour doesn't get pushed sideways by a
 *     wind that wasn't even heading that way.
 *   - dt is sub-stepped so a long pause/tab-switch can't blow up the field.
 *   - Hard speed cap as the final safety net.
 */
export class AirFlowSimulation {
  readonly field: WindField;
  /** Smoothed terrain heights — used in place of raw heights for gradients. */
  private readonly smoothedHeight: Float32Array;
  /** Scratch buffers for the two-phase update (force step then smoothing). */
  private readonly nextVx: Float32Array;
  private readonly nextVy: Float32Array;

  /** Sub-stepping cap. dt larger than this is split into smaller pieces. */
  private static readonly MAX_SUBSTEP = 1 / 30;

  constructor(world: World) {
    this.field = new WindField(world.width, world.height);
    const n = world.width * world.height;
    this.smoothedHeight = new Float32Array(n);
    this.nextVx = new Float32Array(n);
    this.nextVy = new Float32Array(n);
    this.smoothHeights(world);
  }

  /** Discard wind state. Called when the world is regenerated. */
  reset(world: World): void {
    this.field.reset();
    this.smoothHeights(world);
  }

  /** 1-pass box blur over the 6-neighbour ring + self. */
  private smoothHeights(world: World): void {
    const w = world.width;
    const h = world.height;
    for (let row = 0; row < h; row++) {
      const offs = offsetNeighbours(row);
      for (let col = 0; col < w; col++) {
        const idx = row * w + col;
        let sum = world.tiles[idx].height;
        let count = 1;
        for (let i = 0; i < 6; i++) {
          const o = offs[i];
          const nc = col + o.dc;
          const nr = row + o.dr;
          if (nc < 0 || nc >= w || nr < 0 || nr >= h) continue;
          sum += world.tiles[nr * w + nc].height;
          count++;
        }
        this.smoothedHeight[idx] = sum / count;
      }
    }
  }

  /** Run the simulation forward by dt seconds, with internal sub-stepping. */
  step(world: World, params: AirFlowParams, dt: number): void {
    if (dt <= 0) return;
    const subs = Math.max(1, Math.ceil(dt / AirFlowSimulation.MAX_SUBSTEP));
    const subDt = dt / subs;
    for (let i = 0; i < subs; i++) {
      this.singleStep(world, params, subDt);
    }
  }

  private singleStep(world: World, params: AirFlowParams, dt: number): void {
    const w = world.width;
    const h = world.height;
    const { vx, vy } = this.field;
    const sh = this.smoothedHeight;

    const ax = Math.cos(params.ambientDirection) * params.ambientSpeed;
    const ay = Math.sin(params.ambientDirection) * params.ambientSpeed;

    // First-order rate damping: v *= exp(-damping*dt). retain<1 always.
    const retain = Math.exp(-Math.max(0, params.damping) * dt);
    const coupling = params.terrainCoupling;
    const overcome = params.overcomeFactor;
    const maxSpeed = params.maxSpeed;
    const maxSpeedSq = maxSpeed * maxSpeed;

    // ----- Phase 1: apply forces, write to scratch buffer -----
    for (let row = 0; row < h; row++) {
      const offs = offsetNeighbours(row);
      for (let col = 0; col < w; col++) {
        const idx = row * w + col;
        const myH = sh[idx];
        const cvx = vx[idx];
        const cvy = vy[idx];
        const speed = Math.hypot(cvx, cvy);

        // Ambient + terrain accumulator.
        let fx = ax;
        let fy = ay;

        for (let i = 0; i < 6; i++) {
          const o = offs[i];
          const nc = col + o.dc;
          const nr = row + o.dr;
          if (nc < 0 || nc >= w || nr < 0 || nr >= h) continue;

          const dh = sh[nr * w + nc] - myH;
          if (dh <= 0) continue; // neighbour is downhill, no pushback

          const d = NEIGHBOUR_DIRS[i];
          const dot = cvx * d.x + cvy * d.y;
          if (dot <= 0) continue; // wind isn't heading uphill, skip

          // Strong winds overcome terrain. The (1 + speed*overcome) divisor
          // smoothly attenuates the push.
          const push = (dh * coupling) / (1 + speed * overcome);
          fx -= d.x * push;
          fy -= d.y * push;
        }

        // Integrate: damped velocity + force impulse over dt.
        let nvx = cvx * retain + fx * dt;
        let nvy = cvy * retain + fy * dt;

        // Hard speed cap.
        const sq = nvx * nvx + nvy * nvy;
        if (sq > maxSpeedSq) {
          const k = maxSpeed / Math.sqrt(sq);
          nvx *= k;
          nvy *= k;
        }

        this.nextVx[idx] = nvx;
        this.nextVy[idx] = nvy;
      }
    }

    // ----- Phase 2: optional 6-neighbour smoothing pass -----
    const s = Math.max(0, Math.min(1, params.smoothing));
    if (s > 0) {
      const r = 1 - s;
      for (let row = 0; row < h; row++) {
        const offs = offsetNeighbours(row);
        for (let col = 0; col < w; col++) {
          const idx = row * w + col;
          let sx = 0;
          let sy = 0;
          let count = 0;
          for (let i = 0; i < 6; i++) {
            const o = offs[i];
            const nc = col + o.dc;
            const nr = row + o.dr;
            if (nc < 0 || nc >= w || nr < 0 || nr >= h) continue;
            const ni = nr * w + nc;
            sx += this.nextVx[ni];
            sy += this.nextVy[ni];
            count++;
          }
          if (count === 0) {
            vx[idx] = this.nextVx[idx];
            vy[idx] = this.nextVy[idx];
          } else {
            vx[idx] = this.nextVx[idx] * r + (sx / count) * s;
            vy[idx] = this.nextVy[idx] * r + (sy / count) * s;
          }
        }
      }
    } else {
      vx.set(this.nextVx);
      vy.set(this.nextVy);
    }
  }
}
