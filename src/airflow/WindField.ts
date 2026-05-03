/**
 * Per-tile 2D wind vector field, aligned to the offset hex grid.
 *
 * Stored as parallel Float32Arrays for cache locality in the simulation hot
 * loop. Index by `row * width + col`.
 */
export class WindField {
  readonly width: number;
  readonly height: number;
  readonly vx: Float32Array;
  readonly vy: Float32Array;

  /** Magnitude of the random per-cell seed used by `seed()`. */
  static readonly SEED_AMPLITUDE = 0.01;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    const n = width * height;
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.seed();
  }

  index(col: number, row: number): number {
    return row * this.width + col;
  }

  inBounds(col: number, row: number): boolean {
    return col >= 0 && col < this.width && row >= 0 && row < this.height;
  }

  /**
   * Seed the field with a tiny random vector per cell. Pure zero is a fixed
   * point of the dynamics (the terrain force is direction-gated), so a
   * micro-perturbation lets the simulation actually evolve.
   */
  seed(): void {
    const a = WindField.SEED_AMPLITUDE;
    for (let i = 0; i < this.vx.length; i++) {
      this.vx[i] = (Math.random() - 0.5) * a;
      this.vy[i] = (Math.random() - 0.5) * a;
    }
  }

  reset(): void {
    this.seed();
  }
}
