import { describe, expect, it } from 'vitest';
import { gridFrame } from '../../tiles/geometry';
import { createDeck, deckMap, type SkyField } from '../cloudDeck';

const [cols, rows, SIZE] = [16, 12, 10];
const map = deckMap(cols, rows, SIZE, gridFrame(cols, rows, SIZE));
const n = cols * rows;
/** Cloud over a patch of hexes around (6, 6), clear elsewhere. */
const patch = (amount: number, near = (c: number, r: number) => Math.abs(c - 6) <= 1 && Math.abs(r - 6) <= 1) =>
  Float32Array.from({ length: n }, (_, i) => (near(i % cols, Math.floor(i / cols)) ? amount : 0));
const sky = (cloud: Float32Array, wind = { x: 0, y: 0 }, fall = new Float32Array(n), snow?: (i: number) => boolean): SkyField => ({
  cloud,
  fall,
  windX: new Float32Array(n).fill(wind.x),
  windY: new Float32Array(n).fill(wind.y),
  snow,
});
const centreOf = (c: number, r: number) => map.centre(r * cols + c);

describe('createDeck', () => {
  it('puts full-grown puffs where there is cloud, and none where the sky is clear', () => {
    const deck = createDeck(map, 1);
    deck.reset(sky(patch(0.1)));
    expect(deck.puffs.length).toBeGreaterThan(0);
    expect(deck.puffs.length).toBeLessThanOrEqual(9);
    const middle = centreOf(6, 6);
    for (const p of deck.puffs) {
      expect(p.size).toBe(p.target);
      expect(p.shown).toBe(1);
      expect(Math.hypot(p.x - middle.x, p.y - middle.y)).toBeLessThan(3 * map.spacing);
    }
    deck.reset(sky(new Float32Array(n)));
    expect(deck.puffs.length).toBe(0);
  });

  it('makes thicker cloud into bigger puffs', () => {
    const [thin, thick] = [createDeck(map, 1), createDeck(map, 1)];
    thin.reset(sky(patch(0.03)));
    thick.reset(sky(patch(0.12)));
    const widest = (d: typeof thin) => Math.max(...d.puffs.map((p) => p.size));
    expect(widest(thick)).toBeGreaterThan(widest(thin));
  });

  it('drifts its puffs with the wind, smoothly between steps', () => {
    const deck = createDeck(map, 1);
    const cloud = patch(0.1);
    deck.reset(sky(cloud, { x: 0.3, y: 0 }));
    const before = deck.puffs.map((p) => ({ x: p.x, y: p.y }));
    deck.update(sky(cloud, { x: 0.3, y: 0 }), 0.5);
    deck.puffs.slice(0, before.length).forEach((p, k) => {
      expect(p.x - before[k].x).toBeCloseTo(0.15 * map.spacing, 5);
      expect(p.y).toBeCloseTo(before[k].y, 5);
    });
  });

  it('grows new puffs in where cloud forms, and lets them fade away where it dissolves', () => {
    const deck = createDeck(map, 1);
    deck.reset(sky(new Float32Array(n)));
    deck.update(sky(patch(0.1)), 1);
    expect(deck.puffs.length).toBeGreaterThan(0);
    expect(deck.puffs.every((p) => p.size < p.target && p.shown < 0.2)).toBe(true);
    for (let k = 0; k < 80; k++) deck.update(sky(patch(0.1)), 1);
    expect(deck.puffs.every((p) => p.size > 0.9 * p.target && p.shown > 0.9)).toBe(true);
    for (let k = 0; k < 200; k++) deck.update(sky(new Float32Array(n)), 1);
    expect(deck.puffs.length).toBe(0);
  });

  it('does not heap puffs up on a cloud that stays, nor where the wind blows through one standing over a mountain', () => {
    const deck = createDeck(map, 1);
    const cloud = patch(0.1, () => true);
    for (let k = 0; k < 100; k++) deck.update(sky(cloud), 1);
    expect(deck.puffs.length).toBeLessThan(n / 3);
    const standing = createDeck(map, 1);
    const mountain = patch(0.1, (c) => c >= 4 && c <= 11);
    for (let k = 0; k < 200; k++) standing.update(sky(mountain, { x: 0.05, y: 0 }), 0.25);
    expect(standing.puffs.filter((p) => p.target > 0).length).toBeLessThan((8 * rows) / 2);
    expect(standing.puffs.length).toBeLessThan(8 * rows);
  });

  it('darkens puffs that rain, and tells rain from snow', () => {
    const deck = createDeck(map, 1);
    const cloud = patch(0.1);
    deck.reset(sky(cloud, undefined, patch(0.02), () => true));
    expect(deck.puffs.every((p) => p.dark > 0.5 && p.fall > 0.5 && p.snow)).toBe(true);
    deck.reset(sky(cloud));
    expect(deck.puffs.every((p) => p.dark === 0 && p.fall === 0 && !p.snow)).toBe(true);
  });

  it('drifts each puff with the wind where it is', () => {
    const deck = createDeck(map, 1);
    const cloud = patch(0.1, (c, r) => (c === 3 || c === 12) && r === 6);
    deck.reset(sky(cloud));
    const windX = Float32Array.from({ length: n }, (_, i) => (i % cols < 8 ? 0.3 : -0.3));
    const before = deck.puffs.map((p) => p.x);
    deck.update({ ...sky(cloud), windX }, 1);
    deck.puffs.slice(0, before.length).forEach((p, k) => expect(Math.sign(p.x - before[k])).toBe(before[k] < centreOf(8, 6).x ? 1 : -1));
  });

  it('glides: a puff takes up a change of wind gradually, not at once', () => {
    const deck = createDeck(map, 1);
    const cloud = patch(0.1);
    deck.reset(sky(cloud));
    const p = deck.puffs[0];
    const x0 = p.x;
    deck.update(sky(cloud, { x: 0.3, y: 0 }), 0.1);
    expect(p.x - x0).toBeGreaterThan(0);
    expect(p.x - x0).toBeLessThan(0.3 * map.spacing * 0.1 * 0.5);
    for (let k = 0; k < 40; k++) deck.update(sky(cloud, { x: 0.3, y: 0 }), 0.25);
    expect(p.vx).toBeCloseTo(0.3 * map.spacing, 1);
  });

  it('feels the wind blended over the hexes around it, so crossing a hex edge it does not lurch', () => {
    // Wind east, half as strong in the eastern half of the map: a puff crossing over speeds down smoothly.
    const windX = Float32Array.from({ length: n }, (_, i) => (i % cols < 8 ? 0.3 : 0.15));
    const field = { ...sky(patch(0.1, (c, r) => c === 5 && r === 6)), windX };
    const deck = createDeck(map, 1);
    deck.reset(field);
    const p = deck.puffs[0];
    for (let k = 0; k < 20; k++) deck.update(field, 0.25); // settled into the western wind
    const speeds: number[] = [];
    for (let k = 0; k < 60 && p.x < centreOf(11, 6).x; k++) {
      deck.update(field, 0.25);
      speeds.push(p.vx);
    }
    const jumps = speeds.slice(1).map((v, k) => Math.abs(v - speeds[k]));
    expect(Math.max(...jumps)).toBeLessThan(0.15 * map.spacing * 0.2);
    expect(speeds.at(-1)!).toBeLessThan(speeds[0]);
  });

  it('lets puffs that drift off the map fade', () => {
    const deck = createDeck(map, 1);
    const cloud = patch(0.1);
    deck.reset(sky(cloud));
    for (let k = 0; k < 200; k++) deck.update(sky(new Float32Array(n), { x: 0.4, y: 0 }), 1);
    expect(deck.puffs.length).toBe(0);
  });
});

describe('deckMap', () => {
  it('finds the hex under a pixel and none off the map', () => {
    const c = centreOf(3, 4);
    expect(map.hexAt(c.x, c.y)).toBe(4 * cols + 3);
    expect(map.hexAt(-50, -50)).toBe(-1);
    expect(map.spacing).toBeCloseTo(SIZE * Math.sqrt(3));
  });
});
