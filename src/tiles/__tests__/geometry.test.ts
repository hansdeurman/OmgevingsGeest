import { describe, expect, it } from 'vitest';
import { gridFrame, isoSideFaces, isoTop, toIso } from '../geometry';

const view = { squash: 0.5, thickness: 6, step: 4 };

describe('gridFrame', () => {
  it('encloses the grid and shifts hex (0,0) inside it', () => {
    const f = gridFrame(2, 2, 10);
    expect(f.ox).toBeCloseTo(Math.sqrt(3) * 5, 9);
    expect(f.oy).toBe(10);
    expect(f.width).toBe(Math.ceil(Math.sqrt(3) * 10 * 2.5));
    expect(f.height).toBe(35);
  });
});

describe('iso projection', () => {
  it('squashes y only', () => {
    expect(toIso({ x: 4, y: 10 }, view)).toEqual({ x: 4, y: 5 });
  });

  it('projects all six corners of the top face', () => {
    const top = isoTop({ x: 0, y: 0 }, 10, view);
    expect(top).toHaveLength(6);
    expect(Math.max(...top.map((p) => p.y))).toBeCloseTo(5, 9);
  });

  it('extrudes the two front faces downward by the slab thickness', () => {
    const [left, right] = isoSideFaces({ x: 0, y: 0 }, 10, view);
    for (const face of [left, right]) {
      expect(face).toHaveLength(4);
      expect(face[2].y - face[1].y).toBeCloseTo(view.thickness, 9);
      expect(face[3].y - face[0].y).toBeCloseTo(view.thickness, 9);
    }
    expect(Math.max(...left.map((p) => p.x))).toBeCloseTo(0, 9);
    expect(Math.min(...right.map((p) => p.x))).toBeCloseTo(0, 9);
  });

  it('lifts the top face and stretches the walls down to the base', () => {
    const flat = isoTop({ x: 0, y: 0 }, 10, view);
    const raised = isoTop({ x: 0, y: 0 }, 10, view, 12);
    raised.forEach((p, i) => expect(flat[i].y - p.y).toBeCloseTo(12, 9));
    const [left] = isoSideFaces({ x: 0, y: 0 }, 10, view, 12);
    expect(left[3].y - left[0].y).toBeCloseTo(12 + view.thickness, 9);
  });
});
