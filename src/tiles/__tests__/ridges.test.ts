import { describe, expect, it } from 'vitest';
import { offsetToPixel } from '../../math/hex';
import { createCoverGrid } from '../coverGrid';
import { ridgeProps } from '../ridges';

const SIZE = 10;
/** One row of cells with these elevations; 'd' marks a damp cell and 'L' a lake cell, both at elevation 7. */
const row = (...cells: (number | 'd' | 'L')[]) =>
  createCoverGrid(cells.length, 1, (col) => {
    const c = cells[col];
    return c === 'd' ? { water: 1, elevation: 7 } : c === 'L' ? { water: 3, elevation: 7 } : { elevation: c };
  });

describe('ridgeProps', () => {
  it('puts a mountain on every high cell and joins neighbouring ones into a chain', () => {
    const props = ridgeProps(row(7, 7, 7, 1), SIZE, 1);
    expect(props.filter((p) => p.kind === 'peak')).toHaveLength(5); // 3 centres + 2 links
    const c0 = offsetToPixel(0, 0, SIZE);
    const c1 = offsetToPixel(1, 0, SIZE);
    const link = props.find((p) => Math.abs(p.x - (c0.x + c1.x) / 2) < SIZE * 0.2 && Math.abs(p.y - c0.y) < SIZE * 0.2);
    expect(link).toBeDefined();
  });

  it('leaves a gap where the ground is lower: water can pass there', () => {
    const props = ridgeProps(row(7, 2, 7), SIZE, 1);
    expect(props).toHaveLength(2);
    expect(props.every((p) => p.col !== 1)).toBe(true);
  });

  it('keeps lakes and blocked cells (rivers) free, but lets mountains stand on damp ground', () => {
    expect(ridgeProps(row(7, 7, 7), SIZE, 1, new Set([1]))).toHaveLength(2);
    expect(ridgeProps(row(7, 'd', 7), SIZE, 1)).toHaveLength(5);
    expect(ridgeProps(row(1, 'L', 1), SIZE, 1)).toHaveLength(0);
  });

  it('tags each mountain with the elevation it stands for, a link with its lower side', () => {
    const props = ridgeProps(row(7, 5), SIZE, 1);
    expect(props.find((p) => p.kind === 'peak')?.elevation).toBe(7);
    expect(props.filter((p) => p.kind === 'hill').map((p) => p.elevation)).toEqual([5, 5]);
  });

  it('fills the middle between three high cells, so no bare floor shows between peaks', () => {
    const tri = createCoverGrid(2, 2, () => ({ elevation: 7 })); // (0,0), (1,0) and (0,1) are mutual neighbours
    const props = ridgeProps(tri, SIZE, 1);
    const centres = [0, 1, 2, 3].map((i) => offsetToPixel(i % 2, Math.floor(i / 2), SIZE));
    const centroid = { x: (centres[0].x + centres[1].x + centres[2].x) / 3, y: (centres[0].y + centres[1].y + centres[2].y) / 3 };
    expect(props.some((p) => Math.hypot(p.x - centroid.x, p.y - centroid.y) < SIZE * 0.3)).toBe(true);
  });

  it('grows from hills to crags to snowy peaks with height; a link takes the lower side', () => {
    const kinds = ridgeProps(row(5, 1, 6, 1, 7), SIZE, 1).map((p) => p.kind);
    expect(kinds).toEqual(['hill', 'crag', 'peak']);
    const link = ridgeProps(row(7, 5), SIZE, 1).find((p) => p.col === 0 && p.kind !== 'peak');
    expect(link?.kind).toBe('hill');
  });

  it('is deterministic for a seed', () => {
    expect(ridgeProps(row(7, 7, 6), SIZE, 4)).toEqual(ridgeProps(row(7, 7, 6), SIZE, 4));
  });
});
