import { createTile, type Tile } from './Tile';

/**
 * Container for the hex grid. Stores tiles in a flat row-major array indexed
 * by (col, row). Knows nothing about generation or rendering — those layers
 * read/write tile fields through this surface.
 */
export class World {
  readonly width: number;
  readonly height: number;
  readonly tiles: Tile[];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.tiles = new Array(width * height);
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        this.tiles[row * width + col] = createTile(col, row);
      }
    }
  }

  at(col: number, row: number): Tile | undefined {
    if (col < 0 || col >= this.width || row < 0 || row >= this.height) return undefined;
    return this.tiles[row * this.width + col];
  }
}
