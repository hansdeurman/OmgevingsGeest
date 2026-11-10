import { describe, expect, it } from 'vitest';
import { OVERCAST } from '../../water/waterCycle';
import { hexReadout, type HexView } from '../hexReadout';

const one = (change: Partial<Record<keyof HexView, number>> = {}): HexView => {
  const v = { temperature: 14.24, cloud: OVERCAST / 2, fall: 0.0123, wetness: 2.6, snow: 0, plants: 0.45, room: 0.9, ...change };
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, [x]])) as unknown as HexView;
};

describe('hexReadout', () => {
  it('reads temperature, cloud cover, rain, wetness and plants of a hex', () => {
    expect(hexReadout(one(), 0, [0.9])).toBe('🌡 14.2° · ☁ 50% · 🌧 0.012 · 💧 moist 2.6 · 🌱 0.45/0.90');
  });

  it('tells how much the plants grew past what was painted, and snow where it lies', () => {
    const line = hexReadout(one({ room: 0.95, snow: 0.2 }), 0, [0.3]);
    expect(line).toContain('🌱 0.45/0.95 (was 0.30)');
    expect(line).toContain('❄ 0.20');
  });

  it('caps the cloud cover at full and names the wetness within its scale', () => {
    const line = hexReadout(one({ cloud: 3 * OVERCAST, wetness: 9 }), 0, [0.9]);
    expect(line).toContain('☁ 100%');
    expect(line).toContain('💧 deep 9.0');
  });
});
