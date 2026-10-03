import { describe, expect, it } from 'vitest';
import { WETNESS } from '../../../water/wetness';
import { LOOK_RES, lookTable } from '../../wetGround';
import { riverMesh, RIVER_VERTEX } from '../groundGLData';
import type { RiverLine } from '../../riverPaint';

describe('lookTable', () => {
  const { width, data } = lookTable();
  const at = (row: number, stage: number, k: number) => data[(row * width + Math.round(stage * LOOK_RES)) * 4 + k];

  it('tables every look per stage, two rows of four', () => {
    expect(width).toBe(WETNESS.deep * LOOK_RES + 1);
    expect(data).toHaveLength(width * 2 * 4);
  });

  it('holds what grading reads: normal ground unchanged, straw when parched, water when flooded', () => {
    expect([at(0, WETNESS.normal, 0), at(0, WETNESS.normal, 2), at(0, WETNESS.normal, 3), at(1, WETNESS.normal, 0)]).toEqual([0, 1, 0, 0]);
    expect(at(0, WETNESS.parched, 0)).toBeGreaterThan(0.5); // straw
    expect(at(1, WETNESS.flooded, 0)).toBeGreaterThanOrEqual(1); // all of it under water
  });
});

describe('riverMesh', () => {
  const line: RiverLine = {
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }],
    bed: Float32Array.of(4, 4, 8),
    water: Float32Array.of(0, 2, 2),
    foam: Float32Array.of(0, 0.5, 1),
  };
  const vertex = (mesh: Float32Array, k: number) => Array.from(mesh.subarray(k * RIVER_VERTEX, (k + 1) * RIVER_VERTEX));

  it('makes two triangles per stretch, as wide as the river there, with how far across each corner lies', () => {
    const mesh = riverMesh([line], 'bed');
    expect(mesh).toHaveLength(2 * 2 * 3 * RIVER_VERTEX);
    const ys = Array.from({ length: 12 }, (_, k) => vertex(mesh, k)[1]);
    expect(Math.max(...ys)).toBeCloseTo(4); // half of the widest bed, 8
    expect(Math.min(...ys)).toBeCloseTo(-4);
    const across = Array.from({ length: 12 }, (_, k) => vertex(mesh, k)[2]);
    expect(new Set(across)).toEqual(new Set([-1, 1]));
  });

  it('carries how white the water is per corner', () => {
    const foam = Array.from({ length: 12 }, (_, k) => vertex(riverMesh([line], 'water'), k)[3]);
    expect(Math.max(...foam)).toBe(1);
  });

  it('leaves out stretches without water', () => {
    const dry: RiverLine = { ...line, water: new Float32Array(3) };
    expect(riverMesh([dry], 'water')).toHaveLength(0);
  });
});
