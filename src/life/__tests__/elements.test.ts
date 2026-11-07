import { describe, expect, it } from 'vitest';
import { BEATS, DRAWS_ON, EDGE, edgeOf, ELEMENT_LOOK, ELEMENTS, familyOf, matchup, POWER_HINT, POWER_KINDS, POWERS_OF, QUALITIES } from '../elements';

describe('elements', () => {
  it('each has its own bright colour and draws on its own quality of the world', () => {
    const colours = ELEMENTS.map((e) => ELEMENT_LOOK[e].colour);
    expect(new Set(colours).size).toBe(ELEMENTS.length);
    colours.forEach((c) => expect(c).toMatch(/^#[0-9A-F]{6}$/));
    const draws = ELEMENTS.map((e) => DRAWS_ON[e]);
    expect(new Set(draws).size).toBe(ELEMENTS.length);
    draws.forEach((q) => expect(QUALITIES).toContain(q));
  });

  it('each can work at least one power, and every power is worked by some element and explained', () => {
    ELEMENTS.forEach((e) => expect(POWERS_OF[e].length).toBeGreaterThan(0));
    const used = new Set(ELEMENTS.flatMap((e) => POWERS_OF[e]));
    POWER_KINDS.forEach((p) => {
      expect(used.has(p)).toBe(true);
      expect(POWER_HINT[p].length).toBeGreaterThan(0);
    });
  });

  it('sorts each power into its family', () => {
    expect(familyOf('warm')).toBe('thermal');
    expect(familyOf('gust')).toBe('kinetic');
    expect(familyOf('spark')).toBe('radiant');
    expect(familyOf('freeze')).toBe('hydro');
    expect(familyOf('lure')).toBe('mind');
  });
});

describe('BEATS', () => {
  it('gives every element two it gets the better of and at least one that gets the better of it, never both ways', () => {
    for (const a of ELEMENTS) {
      expect(BEATS[a]).toHaveLength(2);
      expect(ELEMENTS.some((b) => BEATS[b].includes(a))).toBe(true);
      BEATS[a].forEach((b) => expect(BEATS[b]).not.toContain(a));
    }
  });
});

describe('matchup', () => {
  it('favours water against fire, as much as it holds fire back against water', () => {
    expect(edgeOf('water', 'fire')).toBe(EDGE);
    expect(edgeOf('fire', 'water')).toBeCloseTo(1 / EDGE);
    expect(edgeOf('wind', 'stone')).toBe(1);
  });

  it('lets a blend use its best element, against all of the other’s', () => {
    expect(matchup(['fire', 'water'], ['stone'])).toBe(EDGE);
    expect(matchup(['water'], ['fire', 'stone'])).toBeCloseTo(EDGE * EDGE);
    expect(matchup(['fire'], ['water', 'organic'])).toBeCloseTo(1);
  });
});
