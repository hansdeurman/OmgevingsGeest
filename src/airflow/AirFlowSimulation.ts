import type { World } from '../world/World';
import { offsetNeighbours, NEIGHBOUR_DIRS } from '../math/hex';
import { HEX_PIXEL_SIZE } from '../config/parameters';
import { WindField } from './WindField';
import type { WindSource } from './sources';

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
  /**
   * Multiplier on the natural CFL advection rate. The physical rate is
   * `speed * dt / hex_size`; this multiplier scales how aggressively each
   * cell pulls its velocity from its upwind neighbour each step. 1 = pure
   * CFL, higher values make wind propagate visibly faster.
   */
  advection: number;
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
  step(world: World, params: AirFlowParams, dt: number, sources?: ReadonlyArray<WindSource>): void {
    if (dt <= 0) return;
    const subs = Math.max(1, Math.ceil(dt / AirFlowSimulation.MAX_SUBSTEP));
    const subDt = dt / subs;
    for (let i = 0; i < subs; i++) {
      this.singleStep(world, params, subDt);
      if (sources && sources.length) this.applySources(sources);
    }
  }

  /**
   * Force the velocity at each source's cell to its (vx, vy). Treated as a
   * Dirichlet boundary: the source cell ignores the dynamics, neighbouring
   * cells advect from it normally.
   */
  private applySources(sources: ReadonlyArray<WindSource>): void {
    const { vx, vy } = this.field;
    const w = this.field.width;
    const h = this.field.height;
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      if (s.col < 0 || s.col >= w || s.row < 0 || s.row >= h) continue;
      const idx = s.row * w + s.col;
      vx[idx] = s.vx;
      vy[idx] = s.vy;
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
    // Scratch -> field, blending each cell with the neighbour average.
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

    // ----- Phase 3: upwind advection -----
    // Each cell pulls a fraction of its velocity from the neighbour most
    // *upwind* of itself. This is what actually transports wind across the
    // map (the diffusion above only spreads it isotropically). Blend factor
    // is the CFL number `speed * dt / hex_size`, scaled by `advection`.
    const advRate = Math.max(0, params.advection);
    if (advRate > 0) {
      this.nextVx.set(vx);
      this.nextVy.set(vy);
      const invHex = 1 / HEX_PIXEL_SIZE;

      for (let row = 0; row < h; row++) {
        const offs = offsetNeighbours(row);
        for (let col = 0; col < w; col++) {
          const idx = row * w + col;
          const cvx = vx[idx];
          const cvy = vy[idx];
          const speed = Math.hypot(cvx, cvy);
          if (speed < 1e-5) continue;

          // Upwind neighbour: maximises -(v · d_i).
          let bestI = -1;
          let bestDot = 0;
          for (let i = 0; i < 6; i++) {
            const d = NEIGHBOUR_DIRS[i];
            const dot = -(cvx * d.x + cvy * d.y);
            if (dot > bestDot) {
              bestDot = dot;
              bestI = i;
            }
          }
          if (bestI < 0) continue;

          const o = offs[bestI];
          const nc = col + o.dc;
          const nr = row + o.dr;
          if (nc < 0 || nc >= w || nr < 0 || nr >= h) continue;
          const ni = nr * w + nc;

          const alpha = Math.min(1, advRate * speed * dt * invHex);
          this.nextVx[idx] = cvx * (1 - alpha) + vx[ni] * alpha;
          this.nextVy[idx] = cvy * (1 - alpha) + vy[ni] * alpha;
        }
      }

      vx.set(this.nextVx);
      vy.set(this.nextVy);
    }
  }
}
