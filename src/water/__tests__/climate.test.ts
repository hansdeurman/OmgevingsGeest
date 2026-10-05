import { describe, expect, it } from 'vitest';
import { createClimate, seasonOf, YEAR } from '../climate';

describe('createClimate', () => {
  const climate = createClimate(3);
  const warmth = (step: number) => climate.at(step).warmth;

  it('opens in spring, is warmest half a year on and comes round again after a year', () => {
    expect(seasonOf(climate.at(0).yearShare)).toBe('spring');
    expect(warmth(YEAR / 4)).toBeGreaterThan(0.9);
    expect(warmth(YEAR * 0.75)).toBeLessThan(-0.9);
    expect(warmth(10 + YEAR)).toBeCloseTo(warmth(10), 6);
  });

  it('dries the land more the warmer it is, not at all in deep winter', () => {
    expect(climate.at(YEAR / 4).evaporation).toBeGreaterThan(climate.at(0).evaporation);
    expect(climate.at(YEAR * 0.75).evaporation).toBeCloseTo(0, 3);
  });

  it('blows from one side mostly, turning and gusting slowly as weather comes and goes', () => {
    const winds = Array.from({ length: YEAR }, (_, k) => climate.at(k).wind);
    const speeds = winds.map((w) => Math.hypot(w.x, w.y));
    expect(Math.min(...speeds)).toBeGreaterThan(0.05);
    expect(Math.max(...speeds)).toBeLessThan(0.7);
    const turn = winds.slice(1).map((w, k) => Math.abs(Math.atan2(w.x * winds[k].y - w.y * winds[k].x, w.x * winds[k].x + w.y * winds[k].y)));
    expect(Math.max(...turn)).toBeLessThan(0.1);
    const mean = winds.reduce((m, w) => ({ x: m.x + w.x / YEAR, y: m.y + w.y / YEAR }), { x: 0, y: 0 });
    expect(Math.hypot(mean.x, mean.y)).toBeGreaterThan(0.1);
  });

  it('is the same for the same seed and differs between seeds', () => {
    expect(createClimate(3).at(123)).toEqual(climate.at(123));
    expect(createClimate(4).at(123).wind).not.toEqual(climate.at(123).wind);
  });

  it('lifts the air under passing weather systems, which drift with the wind', () => {
    const [cols, rows] = [40, 30];
    const lift = (step: number) => climate.lift(step, cols, rows, new Float32Array(cols * rows));
    const now = lift(200);
    expect(Math.max(...now)).toBeGreaterThan(0.5);
    expect(now.filter((v) => v > 0).length).toBeLessThan(0.6 * cols * rows);
    // A little later the same pattern sits further downwind.
    const later = lift(204);
    const { wind } = climate.at(200);
    const shifted = (c: number, r: number) => later[Math.round(r + (4 * wind.y) / (Math.sqrt(3) / 2)) * cols + Math.round(c + 4 * wind.x)];
    let [same, moved] = [0, 0];
    for (let r = 10; r < 20; r++) for (let c = 10; c < 30; c++) [same, moved] = [same + Math.abs(now[r * cols + c] - later[r * cols + c]), moved + Math.abs(now[r * cols + c] - shifted(c, r))];
    expect(moved).toBeLessThan(same);
  });
});

describe('seasonOf', () => {
  it('names the season of each share of the year', () => {
    expect([0, 0.25, 0.5, 0.75].map(seasonOf)).toEqual(['winter', 'spring', 'summer', 'autumn']);
  });
});
