import type { World } from '../world/World';
import { offsetNeighbours, NEIGHBOUR_DIRS } from '../math/hex';
import { HEX_PIXEL_SIZE } from '../config/parameters';
import { WindField } from './WindField';
import type { WindSource, WindBurst, WindSink } from './sources';

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
  /**
   * Asymmetry: how strongly the *downhill pull* acts relative to the *uphill
   * block*. 0 = wind heading uphill is blocked but wind heading downhill is
   * never accelerated by terrain. 1 = symmetric (downhill pull as strong as
   * uphill block). Realistic values are 0.2..0.5 — air prefers to slide down
   * but the block-up effect is the dominant one.
   */
  downhillRatio: number;
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
  /**
   * Linear drag rate on the scalar density field (per second). Mirrors
   * `damping` for velocity but acts on density only. Keep low — too much and
   * a parcel evaporates before you can watch it travel.
   */
  densityDamping: number;
  /**
   * Per-step random forcing amplitude (units of velocity per second). Adds
   * white noise to each cell's force during phase 1 — breaks symmetry,
   * livens up otherwise-static convergent flow. Zero = fully deterministic.
   */
  turbulence: number;
  /**
   * Coefficient on the density-pressure force `f = -coeff * ∇density`. High
   * density pushes velocity outward (toward lower density), which is what
   * makes flow loop back from where it has piled up — circulation rather
   * than equilibrium.
   */
  pressure: number;
  /**
   * Fraction of density lost when advecting *uphill* per unit of normalised
   * height delta. Implemented as inflow density × exp(-dh * loss), so a
   * cell receiving wind from a lower neighbour loses some density to the
   * climb — analogue of orographic precipitation.
   */
  heightDensityLoss: number;
  /**
   * Direct density diffusion rate (per second). Independent of velocity.
   * Density relaxes toward the terrain-weighted neighbour average so dense
   * air migrates to sparse cells on its own; uphill neighbours contribute
   * less (gated by the same `heightDensityLoss`). 0 = pure velocity-driven
   * transport.
   */
  densityDiffusion: number;
  /**
   * How aggressively velocity decays in cells that aren't carrying density.
   * The intuition: velocity is "the velocity of a parcel" — without a parcel,
   * there's nothing to be moving, so velocity bleeds off. 0 = independent
   * (legacy); higher = stronger gating. Defaults to roughly 1/sec in fully
   * empty cells, smoothly disabled as density approaches the baseline.
   */
  velocityDensityCoupling: number;
  /**
   * Baseline density level. The whole field is initialised to this value, so
   * every cell starts with "atmospheric air" present. It also serves as the
   * reference for V↔ρ coupling and force gating: cells at baseline behave
   * normally; cells below baseline (e.g. near sinks) lack air and feel
   * proportionally less force / more velocity decay.
   */
  baseline: number;
}

/**
 * Hexagonal air-flow simulation.
 *
 * Each step:
 *   1. Apply ambient force + per-cell turbulence noise.
 *   2. Apply a downhill terrain force = -∇h scaled by `coupling`, attenuated
 *      by speed via the "overcome" term (fast wind ignores small terrain).
 *      Gradient-based, so the force naturally redirects flow around hills:
 *      a wind heading toward a peak feels both deceleration AND a sideways
 *      nudge toward whichever flank is lower.
 *   3. Damp via first-order rate.
 *   4. Optionally blend with the 6-neighbour velocity average.
 *   5. Inflow-driven advection of velocity AND density.
 *   6. Mild density damping.
 *
 * Stability tricks (the user warned us about cliff edges):
 *   - Sub-stepping bounds dt so a long pause/tab-switch can't blow up the field.
 *   - Hard speed cap as the final safety net.
 */
export class AirFlowSimulation {
  readonly field: WindField;
  /**
   * Per-tile terrain heights mirrored into a typed array for cache locality
   * in the gradient sweep. Originally box-blurred for stability, but that
   * blur was attenuating sharp peaks ~7× and making mountains feel
   * suspiciously soft. Raw heights now; the substep cap + speed cap handle
   * any cliff edge sharpness fine.
   */
  private readonly smoothedHeight: Float32Array;
  /** Scratch buffers for the two-phase update (force step then smoothing). */
  private readonly nextVx: Float32Array;
  private readonly nextVy: Float32Array;
  /** Scratch buffer for density advection (mirrors nextVx/nextVy). */
  private readonly nextDensity: Float32Array;

  /** Sub-stepping cap. dt larger than this is split into smaller pieces. */
  private static readonly MAX_SUBSTEP = 1 / 30;

  constructor(world: World) {
    this.field = new WindField(world.width, world.height);
    const n = world.width * world.height;
    this.smoothedHeight = new Float32Array(n);
    this.nextVx = new Float32Array(n);
    this.nextVy = new Float32Array(n);
    this.nextDensity = new Float32Array(n);
    this.smoothHeights(world);
  }

  /** Discard wind state. Called when the world is regenerated. */
  reset(world: World): void {
    this.field.reset();
    this.field.density.fill(this.currentBaseline);
    this.smoothHeights(world);
  }

  /**
   * Mirror raw heights into the typed array. (No blur — see class doc.)
   * Kept as a method so reset() can re-run it after world regeneration.
   */
  private smoothHeights(world: World): void {
    for (let i = 0; i < world.tiles.length; i++) {
      this.smoothedHeight[i] = world.tiles[i].height;
    }
  }

  /**
   * Run the simulation forward by dt seconds, with internal sub-stepping.
   * Bursts (one-shot impulses) are stamped exactly once at the start of the
   * call — sub-stepping does NOT re-apply them. Continuous sources are
   * re-applied after every sub-step so they hold their Dirichlet boundary.
   */
  step(
    world: World,
    params: AirFlowParams,
    dt: number,
    sources?: ReadonlyArray<WindSource>,
    bursts?: ReadonlyArray<WindBurst>,
    sinks?: ReadonlyArray<WindSink>,
  ): void {
    if (dt <= 0) return;
    if (bursts && bursts.length) this.applyBursts(bursts);
    const subs = Math.max(1, Math.ceil(dt / AirFlowSimulation.MAX_SUBSTEP));
    const subDt = dt / subs;
    for (let i = 0; i < subs; i++) {
      this.singleStep(world, params, subDt);
      if (sources && sources.length) this.applySources(sources, subDt);
      if (sinks && sinks.length) this.applySinks(sinks, subDt);
    }
  }

  /** Tracked baseline density. The whole field is filled with this on init,
   *  reset, or "Clear Field". Sources push density above it, sinks pull it
   *  below — so deviations from this level are what actually drive flow. */
  private currentBaseline = 1;

  /**
   * Set the baseline density and *immediately* refill the entire density
   * field to that value, wiping any user-built parcels. Called on slider
   * changes from the UI; user explicitly opts in by moving the slider.
   */
  setBaseline(value: number): void {
    this.currentBaseline = value;
    this.field.density.fill(value);
  }

  /** Reset velocity to zero and density to the current baseline. */
  clearField(): void {
    this.field.vx.fill(0);
    this.field.vy.fill(0);
    this.field.density.fill(this.currentBaseline);
  }

  /**
   * Apply each source's Dirichlet boundary at its cell, gated by the source's
   * duty cycle. A source with `duration >= period` (or duration = Infinity)
   * is always on. Otherwise it's on for `duration` seconds out of every
   * `period` seconds, with phase advanced by dt and wrapped modulo period.
   * Density is injected only while "on" and only for sources that carry
   * density (continuous velocity-only sources leave density alone).
   */
  private applySources(sources: ReadonlyArray<WindSource>, dt: number): void {
    const { vx, vy, density } = this.field;
    const w = this.field.width;
    const h = this.field.height;
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      if (s.col < 0 || s.col >= w || s.row < 0 || s.row >= h) continue;

      // Advance phase. Always-on sources skip the modulo (period = Infinity).
      const periodic = Number.isFinite(s.period) && s.period > 0;
      if (periodic) {
        s.phase = (s.phase + dt) % s.period;
      } else {
        s.phase += dt;
      }
      const isOn = !periodic || s.phase < s.duration;
      if (!isOn) continue;

      const idx = s.row * w + s.col;
      vx[idx] = s.vx;
      vy[idx] = s.vy;
      if (s.density > 0) density[idx] = s.density;
    }
  }

  /**
   * Drain density at each sink's cell at its configured rate. Linear loss
   * over dt, clamped to zero — a sink can't make density negative. Velocity
   * is left alone; sinks only consume the scalar parcel.
   */
  private applySinks(sinks: ReadonlyArray<WindSink>, dt: number): void {
    const { density } = this.field;
    const w = this.field.width;
    const h = this.field.height;
    for (let i = 0; i < sinks.length; i++) {
      const s = sinks[i];
      if (s.col < 0 || s.col >= w || s.row < 0 || s.row >= h) continue;
      const idx = s.row * w + s.col;
      const next = density[idx] - s.rate * dt;
      density[idx] = next > 0 ? next : 0;
    }
  }

  /**
   * Stamp a one-shot impulse onto each burst's cell: write velocity AND
   * density at that index. After this returns, the regular dynamics take over
   * and the parcel is on its own — no re-injection across sub-steps.
   */
  private applyBursts(bursts: ReadonlyArray<WindBurst>): void {
    const { vx, vy, density } = this.field;
    const w = this.field.width;
    const h = this.field.height;
    for (let i = 0; i < bursts.length; i++) {
      const b = bursts[i];
      if (b.col < 0 || b.col >= w || b.row < 0 || b.row >= h) continue;
      const idx = b.row * w + b.col;
      vx[idx] = b.vx;
      vy[idx] = b.vy;
      density[idx] = b.density;
    }
  }

  private singleStep(world: World, params: AirFlowParams, dt: number): void {
    const w = world.width;
    const h = world.height;
    const { vx, vy, density } = this.field;
    const sh = this.smoothedHeight;

    const ax = Math.cos(params.ambientDirection) * params.ambientSpeed;
    const ay = Math.sin(params.ambientDirection) * params.ambientSpeed;

    // First-order rate damping: v *= exp(-damping*dt). retain<1 always.
    const retain = Math.exp(-Math.max(0, params.damping) * dt);
    const coupling = params.terrainCoupling;
    const downhillRatio = Math.max(0, Math.min(1, params.downhillRatio));
    const overcome = params.overcomeFactor;
    const maxSpeed = params.maxSpeed;
    const maxSpeedSq = maxSpeed * maxSpeed;
    // Turbulence amplitude. Scales force perturbation per cell per step. The
    // factor breaks symmetry on otherwise-static convergent flows so the wind
    // wobbles and finds escape paths between sources.
    const turb = Math.max(0, params.turbulence);
    const pressure = Math.max(0, params.pressure);
    const heightLoss = Math.max(0, params.heightDensityLoss);
    const vdCoupling = Math.max(0, params.velocityDensityCoupling);
    const baseline = Math.max(1e-3, params.baseline);

    // ----- Phase 1: apply forces, write to scratch buffer -----
    for (let row = 0; row < h; row++) {
      const offs = offsetNeighbours(row);
      for (let col = 0; col < w; col++) {
        const idx = row * w + col;
        const myH = sh[idx];
        const cvx = vx[idx];
        const cvy = vy[idx];
        const speed = Math.hypot(cvx, cvy);
        const myDens = density[idx];

        // Density-gated forcing: forces require air to act on. An empty
        // mountain cell has no density and therefore feels no terrain push,
        // no pressure, no ambient — nothing to push around. Linear ramp:
        // 0 (empty) .. 1 (≥ reference). Density that *did* end up at high
        // ground feels proportional terrain force that drains it back to
        // the valleys, exactly as the user described.
        const densityFactor = Math.min(1, myDens / baseline);

        // Ambient (gated): no air, no breeze.
        let fx = ax * densityFactor;
        let fy = ay * densityFactor;

        // White-noise turbulence forcing. Amplitude grows with local speed so
        // calm areas stay calm and busy areas chop. Skipped when turb = 0 or
        // there is nothing to perturb.
        if (turb > 0 && densityFactor > 0) {
          const k = turb * (0.25 + speed) * densityFactor;
          fx += (Math.random() - 0.5) * 2 * k;
          fy += (Math.random() - 0.5) * 2 * k;
        }

        // Local height gradient AND density gradient in pixel space. Both
        // are sums of (delta * neighbour_dir) over the 6-ring; ∇h points
        // uphill, ∇ρ points toward higher density. We compute them in one
        // sweep to share the neighbour iteration.
        let gx = 0;
        let gy = 0;
        let dgx = 0;
        let dgy = 0;
        for (let i = 0; i < 6; i++) {
          const o = offs[i];
          const nc = col + o.dc;
          const nr = row + o.dr;
          if (nc < 0 || nc >= w || nr < 0 || nr >= h) continue;
          const ni = nr * w + nc;
          const dh = sh[ni] - myH;
          const dd = density[ni] - myDens;
          const d = NEIGHBOUR_DIRS[i];
          gx += dh * d.x;
          gy += dh * d.y;
          dgx += dd * d.x;
          dgy += dd * d.y;
        }

        // Asymmetric terrain force: the *block-uphill* effect is the full
        // coupling; the *pull-downhill* effect is `downhillRatio` of that.
        // We split based on whether the velocity has an uphill component
        // (v · ∇h > 0). With v at rest the dot product is zero and we apply
        // the gentler downhill regime. Strong winds feel less of it (overcome
        // term). All gated by densityFactor — empty cells have no air for
        // the slope to push around.
        const vDotGrad = cvx * gx + cvy * gy;
        const dirFactor = vDotGrad > 0 ? 1 : downhillRatio;
        const tk = (coupling * dirFactor * densityFactor) / (1 + speed * overcome);
        fx -= gx * tk;
        fy -= gy * tk;

        // Pressure force from density: `f = -pressure * ∇ρ`. Pushes velocity
        // toward lower density. Also gated — only existing air pushes itself
        // outward, not the void next to a parcel.
        if (pressure > 0 && densityFactor > 0) {
          const pk = pressure * densityFactor;
          fx -= dgx * pk;
          fy -= dgy * pk;
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

    // ----- Phase 3: inflow-driven advection (velocity AND density together) -----
    // Each cell pulls a fraction of its state from the neighbour most actively
    // flowing INTO it. Critically, the rate is set by *that neighbour's* speed,
    // not the cell's own — otherwise a still cell pulls nothing (alpha = 0) and
    // the wave can never reach quiet air, only diffuse there via smoothing.
    // That was the symptom of "even a continuous source dies after a few hexes".
    //
    // For neighbour i at unit direction d_i (this -> neighbour), the component
    // of its velocity pointing back toward us is -(v_N · d_i). The largest
    // positive value identifies the dominant inflow.
    const advRate = Math.max(0, params.advection);
    if (advRate > 0) {
      this.nextVx.set(vx);
      this.nextVy.set(vy);
      this.nextDensity.set(density);
      const invHex = 1 / HEX_PIXEL_SIZE;

      for (let row = 0; row < h; row++) {
        const offs = offsetNeighbours(row);
        for (let col = 0; col < w; col++) {
          const idx = row * w + col;

          let bestNi = -1;
          let bestInflow = 0;
          for (let i = 0; i < 6; i++) {
            const o = offs[i];
            const nc = col + o.dc;
            const nr = row + o.dr;
            if (nc < 0 || nc >= w || nr < 0 || nr >= h) continue;
            const ni = nr * w + nc;
            const d = NEIGHBOUR_DIRS[i];
            const inflow = -(vx[ni] * d.x + vy[ni] * d.y);
            if (inflow > bestInflow) {
              bestInflow = inflow;
              bestNi = ni;
            }
          }
          if (bestNi < 0) continue;

          const alpha = Math.min(1, advRate * bestInflow * dt * invHex);
          this.nextVx[idx] = vx[idx] * (1 - alpha) + vx[bestNi] * alpha;
          this.nextVy[idx] = vy[idx] * (1 - alpha) + vy[bestNi] * alpha;
          // Density inflow loses a fraction when crossing uphill — a parcel
          // climbing a slope leaves a bit behind (analogue of orographic
          // precipitation). Downhill or flat: full transfer.
          let densityInflow = density[bestNi];
          if (heightLoss > 0) {
            const dh = sh[idx] - sh[bestNi];
            if (dh > 0) densityInflow *= Math.exp(-dh * heightLoss);
          }
          this.nextDensity[idx] = density[idx] * (1 - alpha) + densityInflow * alpha;
        }
      }

      vx.set(this.nextVx);
      vy.set(this.nextVy);
      density.set(this.nextDensity);
    }

    // ----- Phase 4: density damping -----
    // Mild first-order rate decay so a parcel slowly fades while it travels —
    // matches the user-visible expectation that "amplitude gets slightly less".
    const dRetain = Math.exp(-Math.max(0, params.densityDamping) * dt);
    if (dRetain < 1) {
      for (let i = 0; i < density.length; i++) density[i] *= dRetain;
    }

    // ----- Phase 4b: direct density diffusion (terrain-gated) -----
    // Independent of velocity. Each cell relaxes toward the *terrain-weighted*
    // average of its neighbours: uphill neighbours contribute less (their
    // density "isn't reachable"), so density pools in valleys instead of
    // climbing walls. This is what makes dense air spread visibly toward
    // sparse air on its own, without needing velocity to carry it.
    const diffRate = Math.max(0, params.densityDiffusion);
    if (diffRate > 0) {
      this.nextDensity.set(density);
      const alphaDiff = Math.min(1, diffRate * dt);
      for (let row = 0; row < h; row++) {
        const offs = offsetNeighbours(row);
        for (let col = 0; col < w; col++) {
          const idx = row * w + col;
          const myH = sh[idx];
          let weighted = 0;
          let totalWeight = 0;
          for (let i = 0; i < 6; i++) {
            const o = offs[i];
            const nc = col + o.dc;
            const nr = row + o.dr;
            if (nc < 0 || nc >= w || nr < 0 || nr >= h) continue;
            const ni = nr * w + nc;
            const dh = sh[ni] - myH;
            const weight = dh > 0 ? Math.exp(-dh * heightLoss) : 1;
            weighted += density[ni] * weight;
            totalWeight += weight;
          }
          if (totalWeight > 0) {
            const target = weighted / totalWeight;
            this.nextDensity[idx] = density[idx] * (1 - alphaDiff) + target * alphaDiff;
          }
        }
      }
      density.set(this.nextDensity);
    }

    // ----- Phase 5: density-coupled velocity decay -----
    // Velocity follows the parcel: where there's no density passing through,
    // there's nothing for the velocity field to be the velocity of. Cells
    // below `densityReference` get extra exponential damping proportional
    // to how empty they are. At density >= reference the gate is fully off.
    if (vdCoupling > 0) {
      for (let i = 0; i < density.length; i++) {
        const d = density[i];
        if (d >= baseline) continue;
        const lack = 1 - d / baseline; // 0 (full) .. 1 (empty)
        const r = Math.exp(-vdCoupling * lack * dt);
        vx[i] *= r;
        vy[i] *= r;
      }
    }
  }
}
