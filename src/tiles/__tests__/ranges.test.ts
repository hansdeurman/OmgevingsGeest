import { describe, expect, it } from 'vitest';
import { CIRQUE, cirque, nearestOn, rangeHeight, rangeLine, type RangeShape } from '../ranges';

const even: RangeShape['noise'] = () => 0.5;
const shape = (change: Partial<RangeShape> = {}): RangeShape => ({ bend: 0, waver: 0, high: 5, broad: [2, 2], noise: even, ...change });

describe('rangeLine', () => {
  it('runs from one end to the other, low at its ends and high in its middle', () => {
    const line = rangeLine({ x: 0, y: 0 }, { x: 20, y: 0 }, shape());
    expect(line[0]).toMatchObject({ x: 0, y: 0, high: 0 });
    expect(line.at(-1)).toMatchObject({ x: 20, high: 0 });
    expect(line[line.length >> 1].high).toBeCloseTo(5);
  });

  it('bends its middle off the straight line, to the left of its way', () => {
    const line = rangeLine({ x: 0, y: 0 }, { x: 20, y: 0 }, shape({ bend: 4 }));
    expect(line[line.length >> 1].y).toBeCloseTo(4);
    expect(rangeLine({ x: 0, y: 0 }, { x: 20, y: 0 }, shape({ bend: -4 }))[line.length >> 1].y).toBeCloseTo(-4);
  });

  it('wavers, stands higher and broader where its noise says so', () => {
    const noise: RangeShape['noise'] = (s, t) => (s === 0 ? 1 : t);
    const line = rangeLine({ x: 0, y: 0 }, { x: 20, y: 0 }, shape({ waver: 2, broad: [1, 3], noise }));
    expect(line[3].y).toBeCloseTo(2);
    expect(line.at(-1)!.broad).toBeCloseTo(3);
    expect(line[0].broad).toBeCloseTo(1);
  });
});

describe('rangeHeight', () => {
  const line = rangeLine({ x: 0, y: 0 }, { x: 30, y: 0 }, shape());

  it('stands highest on the crest and falls away across the range', () => {
    const across = [0, 1, 2, 4, 8].map((d) => rangeHeight([line], 15, d));
    expect(across[0]).toBeCloseTo(5);
    for (let k = 1; k < across.length; k++) expect(across[k]).toBeLessThan(across[k - 1]);
  });

  it('is mountains a few hexes across, with low foothills further out', () => {
    const mountain = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6].filter((d) => rangeHeight([line], 15, d) >= 3);
    expect(mountain.length).toBeGreaterThanOrEqual(3);
    expect(mountain.length).toBeLessThanOrEqual(5);
    expect(rangeHeight([line], 15, 6)).toBeGreaterThan(0.2);
    expect(rangeHeight([line], 15, 6)).toBeLessThan(1.5);
  });

  it('takes the higher of two ranges, not the two together', () => {
    const other = rangeLine({ x: 15, y: -10 }, { x: 15, y: 10 }, shape({ high: 3 }));
    expect(rangeHeight([line, other], 15, 0)).toBeCloseTo(5);
  });
});

describe('nearestOn', () => {
  it('finds the stretch of crest nearest a place, and how far off it is', () => {
    const line = rangeLine({ x: 0, y: 0 }, { x: 30, y: 0 }, shape());
    const { point, distance } = nearestOn(line, 12, 3);
    expect(point.x).toBeCloseTo(12, 0);
    expect(distance).toBeCloseTo(3, 1);
  });
});

describe('cirque', () => {
  it('hollows a bowl below its floor, a lip above it, and leaves the land beyond as it was', () => {
    expect(cirque(6, 0, 4)).toBeCloseTo(4 - CIRQUE.depth);
    expect(cirque(6, CIRQUE.edge, 4)).toBeCloseTo(4 + CIRQUE.lip);
    expect(cirque(6, CIRQUE.ease, 4)).toBeCloseTo(6);
    expect(cirque(6, 0, 4, 1.5)).toBeCloseTo(4 - CIRQUE.depth + 1.5);
  });

  it('rises from its bottom to its lip all the way', () => {
    const d = [0, 0.3, 0.6, 0.9, 1.2].map((x) => cirque(2, x, 4));
    for (let k = 1; k < d.length; k++) expect(d[k]).toBeGreaterThan(d[k - 1]);
  });
});
