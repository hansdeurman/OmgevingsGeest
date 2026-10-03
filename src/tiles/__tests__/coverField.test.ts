import { describe, expect, it } from 'vitest';
import { offsetNeighbours, offsetToPixel, pixelToOffset } from '../../math/hex';
import { createCoverGrid } from '../coverGrid';
import { createCoverField } from '../coverField';
import { LAYERS, MAX_ELEVATION, levelAmount, type Level } from '../levels';
import { coverAt, elevationAt, type CoverGrid } from '../coverGrid';

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

  it('is the Gaussian blend of a point\'s hex and its neighbours, exactly', () => {
    // The plain formula, written out: the field must give the same, however it is computed.
    const reference = (g: CoverGrid, size: number, blend: number, x: number, y: number) => {
      const out = { water: 0, grass: 0, trees: 0, alt: 0 };
      const { col, row } = pixelToOffset(x, y, size);
      let total = 0;
      for (const [c, r] of [[col, row], ...offsetNeighbours(row).map((d) => [col + d.dc, row + d.dr])]) {
        const cover = coverAt(g, c, r);
        if (!cover) continue;
        const p = offsetToPixel(c, r, size);
        const w = Math.exp(-((x - p.x) ** 2 + (y - p.y) ** 2) / (blend * size) ** 2);
        total += w;
        for (const l of LAYERS) out[l] += w * levelAmount(cover[l]);
        out.alt += (w * elevationAt(g, c, r)) / MAX_ELEVATION;
      }
      if (total > 0) for (const k of [...LAYERS, 'alt'] as const) out[k] /= total;
      return out;
    };
    const lvl = (k: number) => (k % 5) as Level;
    const mixed = createCoverGrid(5, 4, (c, r) => ({ water: lvl(c * 3 + r), grass: lvl(c + r * 2), trees: lvl(c * r), elevation: (c * 7 + r * 3) % 9 }));
    const f = createCoverField(mixed, SIZE, 0.6);
    for (let y = -3; y < 60; y += 2.7) {
      for (let x = -3; x < 90; x += 3.1) {
        const [a, b] = [f.sample(x, y), reference(mixed, SIZE, 0.6, x, y)];
        for (const k of ['water', 'grass', 'trees', 'alt'] as const) expect(a[k]).toBeCloseTo(b[k], 9);
      }
    }
  });
});
