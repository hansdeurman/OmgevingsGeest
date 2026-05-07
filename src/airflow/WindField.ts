/**
 * Per-tile wind state on the offset hex grid.
 *
 * Stores velocity (vx, vy) and a scalar `density` (think: amount of air carried
 * by the flow). Density is transported by the velocity field and is what makes
 * a "wave" visible — velocity alone shows direction, density shows the parcel.
 *
 * Stored as parallel Float32Arrays for cache locality in the simulation hot
 * loop. Index by `row * width + col`.
 */
export class WindField {
  readonly width: number;
  readonly height: number;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly density: Float32Array;

  /** Magnitude of the random per-cell seed used by `seed()`. */
  static readonly SEED_AMPLITUDE = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    const n = width * height;
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.density = new Float32Array(n);
    this.seed();
  }

  index(col: number, row: number): number {
    return row * this.width + col;
  }

  inBounds(col: number, row: number): boolean {
    return col >= 0 && col < this.width && row >= 0 && row < this.height;
  }

  /**
   * Initialise to a clean rest state. Density is zero, velocity is zero. The
   * gradient-based terrain force isn't direction-gated anymore, so true zero
   * is no longer a stuck fixed point — we don't need a noise seed to "kick"
   * the system into motion. Anything with a non-zero force (sources, ambient,
   * turbulence) will move it; otherwise it stays calm, as it should.
   */
  seed(): void {
    this.vx.fill(0);
    this.vy.fill(0);
    this.density.fill(0);
  }

  reset(): void {
    this.seed();
  }

  /** Zero everything. Used by the test-burst tooling for clean isolation. */
  clear(): void {
    this.vx.fill(0);
    this.vy.fill(0);
    this.density.fill(0);
  }
}
