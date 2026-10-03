import { describe, expect, it } from 'vitest';
import { bandsOf, paintInBands } from '../basePool';
import type { BaseTerrain } from '../groundComposer';

describe('bandsOf', () => {
  it('cuts the rows into bands that cover them all, in order, without overlap', () => {
    const bands = bandsOf(100, 6);
    expect(bands).toHaveLength(6);
    expect(bands[0][0]).toBe(0);
    expect(bands.at(-1)![1]).toBe(100);
    for (let k = 1; k < bands.length; k++) expect(bands[k][0]).toBe(bands[k - 1][1]);
  });

  it('makes no empty bands on a short map', () => {
    expect(bandsOf(3, 8).every(([a, b]) => b > a)).toBe(true);
  });
});

describe('paintInBands', () => {
  /** A band of base terrain whose rows say which they are. */
  const band = (y0: number, y1: number): BaseTerrain => {
    const n = y1 - y0;
    return {
      ground: { width: 1, height: n, data: new Uint8ClampedArray(n * 4) },
      field: Float32Array.from({ length: n }, (_, k) => y0 + k),
      elevation: new Float32Array(n),
      rows: new Int16Array(n),
      lake: new Uint8Array(n),
      open: new Uint8Array(n),
    };
  };

  it('has each band painted, as many at a time as there are painters, and joins them in order', async () => {
    let busy = 0;
    let most = 0;
    const paint = async ([y0, y1]: [number, number]) => {
      most = Math.max(most, ++busy);
      await new Promise((r) => setTimeout(r, (y1 - y0) % 3));
      busy--;
      return band(y0, y1);
    };
    const base = await paintInBands(50, 3, paint);
    expect(Array.from(base.field)).toEqual(Array.from({ length: 50 }, (_, k) => k));
    expect(most).toBeLessThanOrEqual(3);
  });
});
