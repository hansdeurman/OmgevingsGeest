import { describe, expect, it } from 'vitest';
import { beaufort, forceColour, windArrows } from '../windOverlay';

describe('beaufort', () => {
  it('turns wind speed into force on the Beaufort scale', () => {
    expect(beaufort(0.2)).toBe(0);
    expect(beaufort(4.5)).toBe(3);
    expect(beaufort(9.5)).toBe(5);
    expect(beaufort(25)).toBe(10);
    expect(beaufort(80)).toBe(12);
  });

  it('gives each force its colour', () => {
    expect(new Set(Array.from({ length: 13 }, (_, f) => forceColour(f))).size).toBe(13);
  });
});

describe('windArrows', () => {
  const view = { scale: 2, x: 10, y: 20, squash: 0.5 };
  const centre = (i: number) => ({ x: 100 * i, y: 50 });
  const field = { windX: [0.4, 0, 0.1], windY: [0, 0.4, 0] };
  const arrows = windArrows(field, centre, 30, view);

  it('puts an arrow on each hex, centred on it, along the wind there, the ground squashed as the view shows it', () => {
    expect(arrows).toHaveLength(3);
    const [east, south] = arrows;
    expect(east.dx).toBeGreaterThan(0);
    expect(east.dy).toBeCloseTo(0);
    expect(east.x + east.dx / 2).toBeCloseTo(10 + 0 * 2);
    expect(east.y + east.dy / 2).toBeCloseTo(20 + 50 * 0.5 * 2);
    expect(south.dy).toBeCloseTo(east.dx * 0.5);
  });

  it('draws harder wind longer and with more force', () => {
    const [strong, , weak] = arrows;
    expect(strong.dx).toBeGreaterThan(weak.dx);
    expect(strong.force).toBeGreaterThan(weak.force);
  });
});
