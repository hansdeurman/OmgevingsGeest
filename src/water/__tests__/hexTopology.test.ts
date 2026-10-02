import { describe, expect, it } from 'vitest';
import { neighbourIndices } from '../../tiles/hydrology';
import { besideCorner, hexTopology, opposite, pipeTarget } from '../hexTopology';

const COLS = 7;
const ROWS = 6;
const map = { cols: COLS, rows: ROWS, elevation: [] };

describe('hexTopology', () => {
  const t = hexTopology(COLS, ROWS, 12);
  const pipes = (i: number) => Array.from({ length: t.dirs }, (_, d) => pipeTarget(t, i, d));

  it('leads the first six pipes of every hex to its six neighbours across its edges', () => {
    for (let i = 0; i < t.n; i++) {
      const edges = pipes(i).slice(0, 6).filter((j) => j >= 0).sort((a, b) => a - b);
      expect(edges).toEqual(neighbourIndices(map, i).sort((a, b) => a - b));
    }
  });

  it('leads the other six past its corners, each between the two neighbours beside that corner', () => {
    for (const middle of [2 * COLS + 3, 3 * COLS + 3]) {
      for (let d = 6; d < 12; d++) {
        const j = pipeTarget(t, middle, d);
        expect(neighbourIndices(map, middle)).not.toContain(j);
        for (const side of besideCorner(d).map((e) => pipeTarget(t, middle, e))) {
          expect(neighbourIndices(map, middle)).toContain(side);
          expect(neighbourIndices(map, j)).toContain(side);
        }
      }
    }
  });

  it('leads every pipe\'s opposite back to where it came from', () => {
    for (let i = 0; i < t.n; i++) {
      for (let d = 0; d < t.dirs; d++) {
        const j = pipeTarget(t, i, d);
        if (j >= 0) expect(pipeTarget(t, j, opposite(d))).toBe(i);
      }
    }
  });

  it('measures corner pipes longer than edge pipes', () => {
    expect(t.length[0]).toBe(1);
    expect(t.length[6]).toBeCloseTo(Math.sqrt(3), 6);
  });

  it('keeps the same few tables however big the map', () => {
    expect(hexTopology(5000, 5000, 12).dc).toHaveLength(24);
  });

  it('can do with edges only', () => {
    expect(hexTopology(COLS, ROWS, 6).dirs).toBe(6);
  });

  it('leads nowhere off the map', () => {
    expect(pipes(0).filter((j) => j < 0).length).toBeGreaterThan(0);
  });
});
