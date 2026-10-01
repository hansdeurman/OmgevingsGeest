import { describe, expect, it } from 'vitest';
import { offsetToPixel } from '../../math/hex';
import { createCoverGrid } from '../coverGrid';
import { createCoverField } from '../coverField';
import { MAX_ELEVATION } from '../levels';

const SIZE = 10;
// Two hexes side by side: dry sand on the left, a full meadow on the right.
const grid = createCoverGrid(2, 1, (col) => ({ grass: col === 1 ? 4 : 0 }));
const field = createCoverField(grid, SIZE, 0.6);
const left = offsetToPixel(0, 0, SIZE);
const right = offsetToPixel(1, 0, SIZE);

describe('createCoverField', () => {
  it('keeps each hex pure at its centre', () => {
    expect(field.sample(left.x, left.y).grass).toBeCloseTo(0, 3);
    expect(field.sample(right.x, right.y).grass).toBeCloseTo(1, 3);
  });

  it('meets halfway on the shared edge', () => {
    const mid = (left.x + right.x) / 2;
    expect(field.sample(mid, 0).grass).toBeCloseTo(0.5, 6);
  });

  it('rises monotonically from one centre to the other', () => {
    let prev = -1;
    for (let t = 0; t <= 1; t += 0.05) {
      const g = field.sample(left.x + (right.x - left.x) * t, 0).grass;
      expect(g).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = g;
    }
  });

  it('knows which points lie on the map', () => {
    expect(field.inside(left.x, left.y)).toBe(true);
    expect(field.inside(-SIZE * 2, 0)).toBe(false);
  });

  it('blends elevation into a normalised altitude', () => {
    const hills = createCoverGrid(2, 1, (col) => ({ elevation: col ? MAX_ELEVATION : 0 }));
    const f = createCoverField(hills, SIZE, 0.6);
    expect(f.sample(right.x, right.y).alt).toBeCloseTo(1, 3);
    expect(f.sample((left.x + right.x) / 2, 0).alt).toBeCloseTo(0.5, 6);
  });

  it('writes into a supplied output object', () => {
    const out = { water: 9, grass: 9, trees: 9, alt: 9 };
    expect(field.sample(right.x, right.y, out)).toBe(out);
    expect(out.water).toBe(0);
  });
});
