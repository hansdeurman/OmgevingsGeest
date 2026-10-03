import { describe, expect, it } from 'vitest';
import { hexSizeFor } from '../display';

describe('hexSizeFor', () => {
  it('paints at full size on a large screen', () => {
    expect(hexSizeFor({ width: 1440, height: 900 })).toBe(40);
  });

  it('paints far fewer pixels on a phone, where the map is shown small anyway', () => {
    expect(hexSizeFor({ width: 390, height: 844 })).toBeLessThanOrEqual(24);
    expect(hexSizeFor({ width: 844, height: 390 })).toBeLessThanOrEqual(24); // turned sideways too
  });

  it('takes a size asked for (within bounds), so it can be tried on any device', () => {
    expect(hexSizeFor({ width: 1440, height: 900 }, '?hex=28')).toBe(28);
    expect(hexSizeFor({ width: 1440, height: 900 }, '?hex=4')).toBe(16);
    expect(hexSizeFor({ width: 1440, height: 900 }, '?hex=abc')).toBe(40);
  });
});
