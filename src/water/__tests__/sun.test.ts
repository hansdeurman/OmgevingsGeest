import { describe, expect, it } from 'vitest';
import { seasonOf, sunlight, yearShare, YEAR } from '../sun';

describe('yearShare', () => {
  it('opens in spring and comes round again after a year', () => {
    expect(seasonOf(yearShare(0))).toBe('spring');
    expect(yearShare(10 + YEAR)).toBeCloseTo(yearShare(10), 9);
    expect(seasonOf(yearShare(YEAR / 4))).toBe('summer');
  });
});

describe('seasonOf', () => {
  it('names the season of each share of the year', () => {
    expect([0, 0.25, 0.5, 0.75].map(seasonOf)).toEqual(['winter', 'spring', 'summer', 'autumn']);
  });
});

describe('sunlight', () => {
  const p = { sun: 2, tilt: 0.3 };

  it('shines most at midsummer and least at midwinter, by the tilt', () => {
    expect(sunlight(0.5, p)).toBeCloseTo(2 * 1.3);
    expect(sunlight(0, p)).toBeCloseTo(2 * 0.7);
  });

  it('brings the same heat over a year whatever the tilt', () => {
    const year = (tilt: number) => Array.from({ length: 100 }, (_, k) => sunlight(k / 100, { sun: 2, tilt })).reduce((a, b) => a + b) / 100;
    expect(year(0.5)).toBeCloseTo(year(0), 6);
  });
});
