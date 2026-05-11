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
   * How many hexes ahead the gradient walks in each direction when
   * sampling terrain. 1 = local-only (legacy: walls only block at
   * point-blank range). Higher values let walls cast an upwind shadow
   * so incoming flow starts deflecting from afar; far-ring contributions
   * are uphill-only with a 1/(step+1) decay.
   */
  terrainHorizon: number;
  /**
   * How aggressively the flow steers SIDEWAYS along a wall it's hitting.
   * When velocity has an uphill component, a force is applied along the
   * wall's tangent direction (toward lower density) so the parcel glides
   * along the wall instead of just decelerating dead and piling up. Per
   * second per unit of normal-component velocity. 0 disables.
   */
  terrainDeflect: number;
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
    const deflect = Math.max(0, params.terrainDeflect);
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
    const terrainHorizon = Math.max(1, Math.floor(params.terrainHorizon));

    // ----- Phase 1: apply forces, write to scratch buffer -----
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const idx = row * w + col;
        const myH = sh[idx];
        const cvx = vx[idx];
        const cvy = vy[idx];
        const speed = Math.hypot(cvx, cvy);
        const myDens = density[idx];

        // Two height-gated factors:
        //   densityFactor — 0 (empty) .. 1 (≥ baseline). Used for forces
        //     that still make sense on atmospheric air (ambient wind).
        //   parcelStrength — 0 (atmospheric) .. 1 (saturated parcel).
        //     Used for forces that *only* act on actual parcels: terrain,
        //     pressure, turbulence. With this, atmospheric cells stop
        //     receiving random kicks and stop pressure-pushing from
        //     neighbour density gradients.
        const dDev = myDens - baseline;
        const densityFactor = Math.min(1, myDens / baseline);
        const parcelStrength = Math.min(1, Math.abs(dDev) / baseline);

        // Ambient (gated by densityFactor — still meaningful on atmospheric air).
        let fx = ax * densityFactor;
        let fy = ay * densityFactor;

        // Constant-amplitude white-noise turbulence on parcel cells. We do
        // NOT scale by speed any more — the old `0.25 + speed` factor
        // amplified noise on cells that already had some velocity, which
        // drowned out the directional pressure force and made density
        // unable to flow coherently from high to low. Now the kick is
        // bounded, pressure has room to win on average over many steps,
        // and parcels actually transport instead of jittering in place.
        if (turb > 0 && parcelStrength > 0) {
          const k = turb * parcelStrength;
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
        // Walk each of the 6 directions out to `horizon` hexes. The first
        // step (immediate neighbour) contributes the full local height +
        // density gradient. Further steps add only *uphill* height
        // differences with a 1/(step+1) decay — anticipation: a wall N
        // hexes away still pulls the local gradient toward itself, so
        // parcels feel an upwind blocking shadow long before they crash
        // into the wall. Without this the gradient is zero outside the
        // wall's immediate neighbourhood and 13-hex-away flow sails in
        // at full speed before meeting any resistance.
        const horizon = terrainHorizon;
        for (let i = 0; i < 6; i++) {
          const d = NEIGHBOUR_DIRS[i];
          let cc = col;
          let rr = row;
          for (let step = 0; step < horizon; step++) {
            const op = offsetNeighbours(rr)[i];
            cc += op.dc;
            rr += op.dr;
            if (cc < 0 || cc >= w || rr < 0 || rr >= h) break;
            const ni = rr * w + cc;
            const dh = sh[ni] - myH;
            if (step === 0) {
              const dd = density[ni] - myDens;
              gx += dh * d.x;
              gy += dh * d.y;
              dgx += dd * d.x;
              dgy += dd * d.y;
            } else if (dh > 0) {
              const weight = 1 / (step + 1);
              gx += dh * d.x * weight;
              gy += dh * d.y * weight;
            }
          }
        }

        // Asymmetric terrain force: the *block-uphill* effect is the full
        // coupling; the *pull-downhill* effect is `downhillRatio` of that.
        // We split based on whether the velocity has an uphill component
        // (v · ∇h > 0). With v at rest the dot product is zero and we apply
        // the gentler downhill regime. Strong winds feel less of it (overcome
        // term).
        //
        // Strict-gated by *parcel strength* (|deviation from baseline| /
        // baseline) rather than absolute density. The mountain only pushes
        // a parcel that's actually on it — atmospheric air at exactly
        // baseline feels nothing, so the wall doesn't generate ghost wind
        // that propagates across the map.
        const vDotGrad = cvx * gx + cvy * gy;
        const dirFactor = vDotGrad > 0 ? 1 : downhillRatio;
        const tk = (coupling * dirFactor * parcelStrength) / (1 + speed * overcome);
        fx -= gx * tk;
        fy -= gy * tk;

        // Pressure force from density: `f = -pressure * ∇ρ`. Pushes velocity
        // toward lower density. Gated by parcelStrength — atmospheric cells
        // at baseline density don't get pushed by neighbour density
        // gradients, only actual parcels do. The parcel cells then spread
        // outward via their own velocity; downstream cells receive density
        // via advection, become parcel cells themselves, and pressure
        // propagates the spread. Atmospheric air stays calm meanwhile.
        if (pressure > 0 && parcelStrength > 0) {
          const pk = pressure * parcelStrength;
          fx -= dgx * pk;
          fy -= dgy * pk;
        }

        // Wall-glide: redirect flow that's actively climbing the local
        // height field along the wall's tangent (toward whichever side
        // has lower parcel density). The two gating conditions:
        //   1. v must have a real uphill component — once the parcel has
        //      crested the wall or is skimming tangentially, vDotGrad
        //      drops to zero or negative and we stop nudging it.
        //   2. magnitude scales with vDotGrad = v · ∇h, i.e. the rate
        //      the parcel is climbing. Steep wall + head-on impact =
        //      strong sideways push; gentle bump or grazing angle =
        //      proportionally less.
        // Downhill flow falls out of both checks naturally: nothing
        // stops or disperses air running down the back side of a wall.
        if (deflect > 0 && parcelStrength > 0 && vDotGrad > 0) {
          const gMag2 = gx * gx + gy * gy;
          if (gMag2 > 1e-9) {
            const gMag = Math.sqrt(gMag2);
            // Require flow to be meaningfully aimed up-slope, not just
            // marginally positive (which a tangent-skimming parcel still
            // is). cosθ = (v · ∇h) / (|v| · |∇h|); below ~0.1 means v is
            // within ~6° of the wall tangent — let it flow.
            const climbAlign = vDotGrad / (speed * gMag);
            if (climbAlign > 0.1) {
              // Unit gradient (wall normal) and 90°-CCW rotation = tangent.
              const gxN = gx / gMag;
              const gyN = gy / gMag;
              const tCCWx = -gyN;
              const tCCWy = gxN;
              // Pick the tangent direction whose density gradient is more
              // negative (toward lower density along the wall).
              const dgDotTangent = dgx * tCCWx + dgy * tCCWy;
              const tx = dgDotTangent <= 0 ? tCCWx : -tCCWx;
              const ty = dgDotTangent <= 0 ? tCCWy : -tCCWy;
              const f = vDotGrad * deflect * parcelStrength;
              fx += tx * f;
              fy += ty * f;
            }
          }
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

    // ----- Phase 3: two-edge barycentric upwind advection -----
    // For each cell with non-zero velocity v, find the 60° sector that
    // contains v (bracketed by two of the six NEIGHBOUR_DIRS, call them
    // n_A and n_B — they are 60° apart so n_A · n_B = ½) and decompose v
    // exactly in that basis: v = α·n_A + β·n_B with α, β ≥ 0. Solving
    //   v·n_A = α + β/2,  v·n_B = α/2 + β
    // gives α = (4/3)(v·n_A) − (2/3)(v·n_B) and β symmetrically.
    //
    // Flux is sent through *just those two* edges, split α : β. The
    // outflow CFL fraction is scaled by (α+β) rather than |v|, so the
    // parcel's centre of mass advances at exactly v·dt per step in any
    // direction — no hex-axis bias. (The earlier dot^sharpness scheme
    // distributed flux to up to 3 edges with weights that gave a faster,
    // tighter beam along the 6 hex axes than between them — visible as
    // the source-burst shape changing dramatically with ambient angle.)
    const advRate = Math.max(0, params.advection);
    if (advRate > 0) {
      this.nextVx.set(vx);
      this.nextVy.set(vy);
      this.nextDensity.set(density);
      const invHex = 1 / HEX_PIXEL_SIZE;

      // Sorted-by-angle index of NEIGHBOUR_DIRS in screen y-down:
      // E(0°), SE(60°), SW(120°), W(180°), NW(240°), NE(300°)
      // → NEIGHBOUR_DIRS indices [0, 5, 4, 3, 2, 1].
      const ANGULAR_ORDER = [0, 5, 4, 3, 2, 1] as const;
      const SECTOR = Math.PI / 3;
      const TWO_PI = Math.PI * 2;

      for (let row = 0; row < h; row++) {
        const offs = offsetNeighbours(row);
        for (let col = 0; col < w; col++) {
          const idx = row * w + col;
          const cvx = vx[idx];
          const cvy = vy[idx];
          const speed = Math.hypot(cvx, cvy);
          if (speed < 1e-5) continue;

          let ang = Math.atan2(cvy, cvx);
          if (ang < 0) ang += TWO_PI;
          const sector = Math.floor(ang / SECTOR) % 6;
          const idxA = ANGULAR_ORDER[sector];
          const idxB = ANGULAR_ORDER[(sector + 1) % 6];
          const nA = NEIGHBOUR_DIRS[idxA];
          const nB = NEIGHBOUR_DIRS[idxB];
          const dotA = cvx * nA.x + cvy * nA.y;
          const dotB = cvx * nB.x + cvy * nB.y;
          let a = (4 / 3) * dotA - (2 / 3) * dotB;
          let b = (4 / 3) * dotB - (2 / 3) * dotA;
          if (a < 0) a = 0;
          if (b < 0) b = 0;
          const ab = a + b;
          if (ab < 1e-12) continue;

          // CFL-scaled outflow fraction. Using (α+β) instead of |v| means
          // an off-axis cell ships ~15% more of its content per step than
          // an on-axis one — exactly the correction needed for the COM
          // to advance at v·dt regardless of direction.
          const alpha = Math.min(1, advRate * ab * dt * invHex);

          // Velocity flux is gated by parcel strength: velocity only travels
          // *with* a deviation from baseline. At baseline, force-generated
          // velocity (e.g. from a mountain edge) doesn't propagate — it
          // stays put and damps locally, instead of shooting across the
          // map as a ghost wind.
          const dDev = density[idx] - baseline;
          const parcelStrength = Math.min(1, Math.abs(dDev) / baseline);
          const fluxVx = cvx * alpha * parcelStrength;
          const fluxVy = cvy * alpha * parcelStrength;
          const fluxD = dDev * alpha;

          this.nextVx[idx] -= fluxVx;
          this.nextVy[idx] -= fluxVy;
          this.nextDensity[idx] -= fluxD;

          const wA = a / ab;
          const wB = b / ab;

          const oA = offs[idxA];
          const ncA = col + oA.dc;
          const nrA = row + oA.dr;
          if (ncA >= 0 && ncA < w && nrA >= 0 && nrA < h) {
            const ni = nrA * w + ncA;
            this.nextVx[ni] += fluxVx * wA;
            this.nextVy[ni] += fluxVy * wA;
            let arriveFactor = 1;
            if (heightLoss > 0) {
              const dh = sh[ni] - sh[idx];
              if (dh > 0) arriveFactor = Math.exp(-dh * heightLoss);
            }
            this.nextDensity[ni] += fluxD * wA * arriveFactor;
          }

          const oB = offs[idxB];
          const ncB = col + oB.dc;
          const nrB = row + oB.dr;
          if (ncB >= 0 && ncB < w && nrB >= 0 && nrB < h) {
            const ni = nrB * w + ncB;
            this.nextVx[ni] += fluxVx * wB;
            this.nextVy[ni] += fluxVy * wB;
            let arriveFactor = 1;
            if (heightLoss > 0) {
              const dh = sh[ni] - sh[idx];
              if (dh > 0) arriveFactor = Math.exp(-dh * heightLoss);
            }
            this.nextDensity[ni] += fluxD * wB * arriveFactor;
          }
        }
      }

      vx.set(this.nextVx);
      vy.set(this.nextVy);
      density.set(this.nextDensity);
    }

    // ----- Phase 4: density damping toward baseline -----
    // First-order relaxation of (density − baseline) toward zero. Without
    // this a continuous source's parcel grows without bound: source pumps
    // density in, advection spreads it, but nothing ever drains it. With
    // even mild damping the system reaches a steady state where source
    // injection balances decay, so the parcel has a *finite* size that
    // tracks source strength rather than expanding to cover the whole map.
    // Conservative: we relax the deviation, leaving baseline cells exactly
    // at baseline.
    const dDamp = Math.max(0, params.densityDamping);
    if (dDamp > 0) {
      const r = Math.exp(-dDamp * dt);
      for (let i = 0; i < density.length; i++) {
        density[i] = baseline + (density[i] - baseline) * r;
      }
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
    // Velocity follows the parcel. Cells well above the parcel threshold
    // (2 × baseline) keep their velocity; cells at baseline or below lose
    // it proportionally. Smoothly ramped so a "thin parcel" decays gently
    // and atmospheric cells decay strongly, while saturated parcels are
    // fully preserved.
    const parcelThreshold = baseline * 2;
    if (vdCoupling > 0) {
      for (let i = 0; i < density.length; i++) {
        const d = density[i];
        if (d >= parcelThreshold) continue;
        const lack = 1 - d / parcelThreshold; // 0 at threshold, 1 at empty
        const r = Math.exp(-vdCoupling * lack * dt);
        vx[i] *= r;
        vy[i] *= r;
      }
    }
  }
}
