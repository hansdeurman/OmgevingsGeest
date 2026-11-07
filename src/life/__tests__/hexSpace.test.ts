import { describe, expect, it } from 'vitest';
import { offsetToPixel } from '../../math/hex';
import { centreOf, hexAt, inside, ring, ROW } from '../hexSpace';

const [cols, rows] = [7, 6];

describe('centreOf', () => {
  it('places hexes as the map does, one hex spacing apart', () => {
    for (const i of [0, 8, 20, 41]) {
      const p = offsetToPixel(i % cols, Math.floor(i / cols), 1 / Math.sqrt(3));
      const c = centreOf(cols, i);
      expect(c.x - centreOf(cols, 0).x).toBeCloseTo(p.x - offsetToPixel(0, 0, 1 / Math.sqrt(3)).x);
      expect(c.y).toBeCloseTo(p.y);
    }
    expect(centreOf(cols, cols).y).toBeCloseTo(ROW);
  });
});

describe('hexAt', () => {
  it('finds the hex a point lies in: its centre’s, and the nearest near an edge', () => {
    for (let i = 0; i < cols * rows; i++) {
      const { x, y } = centreOf(cols, i);
      expect(hexAt(cols, rows, x, y)).toBe(i);
      expect(hexAt(cols, rows, x + 0.3, y - 0.2)).toBe(i);
    }
  });

  it('keeps points off the map on its nearest hex', () => {
    expect(hexAt(cols, rows, -5, -5)).toBe(0);
    expect(hexAt(cols, rows, 99, 99)).toBe(cols * rows - 1);
  });
});

describe('ring', () => {
  it('lists the neighbours of each hex, one spacing away, and none off the map', () => {
    const r = ring(cols, rows);
    const i = 2 * cols + 3;
    const near = Array.from(r.subarray(6 * i, 6 * i + 6));
    expect(near.every((j) => j >= 0)).toBe(true);
    near.forEach((j) => expect(Math.hypot(centreOf(cols, j).x - centreOf(cols, i).x, centreOf(cols, j).y - centreOf(cols, i).y)).toBeCloseTo(1));
    expect(Array.from(r.subarray(0, 6)).filter((j) => j >= 0)).toHaveLength(2);
    expect(ring(cols, rows)).toBe(r);
  });
});

describe('inside', () => {
  it('tells points on the map from those off it', () => {
    expect(inside(cols, rows, 1, 1)).toBe(true);
    expect(inside(cols, rows, -0.5, 1)).toBe(false);
    expect(inside(cols, rows, 1, rows)).toBe(false);
  });
});
