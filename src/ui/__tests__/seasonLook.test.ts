import { describe, expect, it } from 'vitest';
import { seasonLook } from '../seasonLook';

const painted = [0, 0.1, 0.8, 0.02];
/** Four hexes: sea, a deep lake, a meadow, a bare peak. */
const state = (change: { snow?: number[]; surface?: number[]; plants?: number[]; room?: number[] } = {}) => ({
  snow: change.snow ?? [0, 0, 0, 0],
  depth: [0, 1, 0, 0],
  ground: [0, 2, 1, 7],
  surface: change.surface ?? [5, 5, 5, 5],
  plants: change.plants ?? [0, 0, 0.8, 0],
  room: change.room ?? painted,
});

describe('seasonLook', () => {
  it('lays snow on the land as deep as it lies, never on water', () => {
    const look = seasonLook(state({ snow: [1, 1, 0.5, 0.002] }), painted);
    expect(Array.from(look.snow)).toEqual([0, 0, 1, 0]);
  });

  it('freezes the sea and lakes when their surface is cold enough, not the land', () => {
    const look = seasonLook(state({ surface: [-5, -1, -10, -10] }), painted);
    expect(look.ice[0]).toBe(1);
    expect(look.ice[1]).toBeGreaterThan(0);
    expect(look.ice[1]).toBeLessThan(1);
    expect([look.ice[2], look.ice[3]]).toEqual([0, 0]);
  });

  it('shows a lake frozen over as ice, not the sea for snow fallen on it', () => {
    const look = seasonLook(state({ snow: [1, 0.2, 0, 0] }), painted);
    expect(look.ice[1]).toBe(1);
    expect(look.ice[0]).toBe(0);
  });

  it('shows how full the plants are of what the hex grows now; bare rock as it is', () => {
    expect(Array.from(seasonLook(state(), painted).vigour)).toEqual([1, 0, 1, 1]);
    expect(seasonLook(state({ plants: [0, 0, 0.2, 0] }), painted).vigour[2]).toBeCloseTo(0.25);
    expect(seasonLook(state({ plants: [0, 0, 0.5, 0], room: [0, 0.1, 1, 0.02] }), painted).vigour[2]).toBeCloseTo(0.5);
  });

  it('shows land greener than it was painted where more grows on it now, never water', () => {
    expect(Array.from(seasonLook(state(), painted).lush)).toEqual([0, 0, 0, 0]);
    const greened = seasonLook(state({ plants: [1, 1, 0.8, 0.6], room: [0, 1, 0.8, 0.6] }), painted).lush;
    expect([greened[0], greened[1], greened[2]]).toEqual([0, 0, 0]);
    expect(greened[3]).toBe(1);
  });
});
