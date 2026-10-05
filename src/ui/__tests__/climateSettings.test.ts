import { describe, expect, it } from 'vitest';
import { defaultClimate } from '../../water/waterCycle';
import { CLIMATE_SETTINGS, climateReadout, setValue, valueOf, windFrom } from '../climateSettings';

describe('CLIMATE_SETTINGS', () => {
  it('lets every setting slide around its default, each a setting the climate has', () => {
    const p = defaultClimate();
    for (const s of CLIMATE_SETTINGS) {
      expect(typeof valueOf(p, s)).toBe('number');
      expect(valueOf(p, s)).toBeGreaterThanOrEqual(s.min);
      expect(valueOf(p, s)).toBeLessThanOrEqual(s.max);
    }
  });

  it('sets a value where the climate reads it', () => {
    const p = defaultClimate();
    setValue(p, CLIMATE_SETTINGS[0], 3.3);
    expect(p.heat.sun).toBe(3.3);
  });
});

describe('windFrom', () => {
  it('names where the wind blows from', () => {
    expect(windFrom(1, 0)).toBe('W');
    expect(windFrom(0, 1)).toBe('N');
    expect(windFrom(-1, -1)).toBe('SE');
  });
});

describe('climateReadout', () => {
  it('tells the sea, lowland and peak temperatures and the wind', () => {
    const heights = [0, 0, 1, 1, 7];
    const sky = { surface: [9, 9, 12, 12, 1], temperature: [8, 8, 11.4, 11.6, -2.4], windX: [0.1, 0.1, 0.1, 0.1, 0.1], windY: [0, 0, 0, 0, 0] };
    expect(climateReadout(sky, heights)).toBe('Sea 9° · land 12° · peaks -2° · wind 4 m/s W');
  });
});
