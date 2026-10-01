import { describe, expect, it } from 'vitest';
import { median, scaleToMedian } from '../spriteScale';

describe('median', () => {
  it('takes the middle value, or the mean of the middle two', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('scaleToMedian', () => {
  it('maps the median sprite height onto the target height', () => {
    expect(scaleToMedian([100, 200, 300], 40)).toBe(0.2);
  });

  it('keeps relative sizes: a twice-as-tall sprite stays twice as tall', () => {
    const k = scaleToMedian([120, 240], 30);
    expect(240 * k).toBeCloseTo(2 * 120 * k, 9);
  });
});
