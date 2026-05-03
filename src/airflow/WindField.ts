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

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    const n = width * height;
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
  }

  index(col: number, row: number): number {
    return row * this.width + col;
  }

  inBounds(col: number, row: number): boolean {
    return col >= 0 && col < this.width && row >= 0 && row < this.height;
  }

  reset(): void {
    this.vx.fill(0);
    this.vy.fill(0);
  }
}
