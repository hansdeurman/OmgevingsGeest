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
  static readonly SEED_AMPLITUDE = 0.01;

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
   * Seed the velocity field with a tiny random vector per cell. Pure zero is a
   * fixed point of the dynamics (the terrain force is direction-gated), so a
   * micro-perturbation lets the simulation actually evolve. Density is left
   * at zero so test bursts start from a clean, predictable parcel.
   */
  seed(): void {
    const a = WindField.SEED_AMPLITUDE;
    for (let i = 0; i < this.vx.length; i++) {
      this.vx[i] = (Math.random() - 0.5) * a;
      this.vy[i] = (Math.random() - 0.5) * a;
    }
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
