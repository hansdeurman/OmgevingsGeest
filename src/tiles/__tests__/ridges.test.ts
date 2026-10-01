import { describe, expect, it } from 'vitest';
import { offsetToPixel } from '../../math/hex';
import { createCoverGrid } from '../coverGrid';
import { ridgeProps } from '../ridges';

const SIZE = 10;
/** One row of cells with these elevations; 'w' marks a wet cell at elevation 7. */
const row = (...cells: (number | 'w')[]) =>
  createCoverGrid(cells.length, 1, (col) => (cells[col] === 'w' ? { water: 1, elevation: 7 } : { elevation: cells[col] as number }));

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

  it('keeps wet and blocked cells free (a river or lake runs there)', () => {
    expect(ridgeProps(row(7, 'w', 7), SIZE, 1)).toHaveLength(2);
    expect(ridgeProps(row(7, 7, 7), SIZE, 1, new Set([1]))).toHaveLength(2);
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
