import { describe, expect, it } from 'vitest';
import { offsetToPixel } from '../../math/hex';
import { createCoverGrid, type CellInit } from '../coverGrid';
import type { River } from '../rivers';
import { lakeSurface, tarnGroups } from '../tarns';

const SIZE = 10;
const SQUASH = 0.65;
const COLS = 7;
/**
 * Rows of cells: digits are dry ground at that elevation, 'L' a lake cell
 * (water 3) and 'd' a damp shore cell (water 1), both at elevation 6.
 */
const map = (...rows: string[]) =>
  createCoverGrid(COLS, rows.length, (col, row): CellInit => {
    const ch = rows[row][col];
    if (ch === 'L') return { water: 3, elevation: 6 };
    if (ch === 'd') return { water: 1, elevation: 6 };
    return { elevation: Number(ch) };
  });
const idx = (col: number, row: number) => row * COLS + col;
/** A river leaving the lake at `source` into `to`. */
const river = (source: number, to: number): River => ({ cells: [source, to], cascades: [], outlet: [source, to] });

describe('tarnGroups', () => {
  // A three-cell lake in row 2 with a damp shore cell at its right end, in a ring of 7s.
  const g = map('7777777', '7777777', '7LLLd77', '7777777', '2222222');

  it('turns one high lake into one group: a sprite per lake cell plus one on each shared edge', () => {
    const groups = tarnGroups(g, SIZE, 1, [], SQUASH);
    expect(groups).toHaveLength(1);
    expect(groups[0].parts).toHaveLength(3 + 2); // 3 lake cells, 2 links; the damp shore is just ground
    expect(groups[0].parts.every((p) => p.kind === 'tarn')).toBe(true);
  });

  it('gives the lake one water surface, lifted to the rims, spanning all its cells', () => {
    const [{ surface }] = tarnGroups(g, SIZE, 1, [], SQUASH);
    const [a, b] = [offsetToPixel(1, 2, SIZE), offsetToPixel(3, 2, SIZE)];
    expect(surface!.x0).toBeLessThan(a.x);
    expect(surface!.x0 + surface!.width).toBeGreaterThan(b.x);
    expect(surface!.lift).toBeGreaterThan(0);
  });

  it('orders the sprites back to front', () => {
    const { parts } = tarnGroups(map('7777777', '7LL7777', '7LL7777', '7777777', '2222222'), SIZE, 1, [], SQUASH)[0];
    for (let k = 1; k < parts.length; k++) expect(parts[k].y).toBeGreaterThanOrEqual(parts[k - 1].y);
  });

  it('puts the waterfall on the side the lake spills to, mirrored for the left', () => {
    const fallAt = (to: number) => tarnGroups(g, SIZE, 1, [river(idx(2, 2), to)], SQUASH)[0].parts.find((p) => p.col === 2 && p.kind !== 'tarn')!;
    expect(fallAt(idx(2, 3))).toMatchObject({ kind: 'tarnFront', flip: false }); // down-right, toward the viewer
    expect(fallAt(idx(1, 3))).toMatchObject({ kind: 'tarnFront', flip: true }); // down-left
    expect(fallAt(idx(3, 2))).toMatchObject({ kind: 'tarnSide', flip: false });
    expect(tarnGroups(g, SIZE, 1, [river(idx(2, 2), idx(2, 1))], SQUASH)[0].parts.some((p) => p.kind !== 'tarn')).toBe(false); // behind: hidden
  });

  it('shows a lone shallow cell as a pond', () => {
    const lone = createCoverGrid(3, 3, (c, r): CellInit => (c === 1 && r === 1 ? { water: 2, elevation: 6 } : { elevation: 7 }));
    const [pond] = tarnGroups(lone, SIZE, 1, [], SQUASH);
    expect(pond.parts.map((p) => p.kind)).toEqual(['tarnLow']);
    expect(pond.surface).toBeUndefined(); // the pond sprite shows its own little water
  });

  it('keeps separate lakes separate, and leaves low lakes on the ground', () => {
    expect(tarnGroups(map('7777777', '7L777L7', '7777777'), SIZE, 1, [], SQUASH)).toHaveLength(2);
    const low = createCoverGrid(3, 1, (c): CellInit => (c === 1 ? { water: 3, elevation: 2 } : { elevation: 3 }));
    expect(tarnGroups(low, SIZE, 1, [], SQUASH)).toHaveLength(0);
  });
});

describe('lakeSurface', () => {
  const RX = 6;
  const RY = 3;
  const alphaAt = (sf: ReturnType<typeof lakeSurface>, x: number, y: number) =>
    sf.alpha[Math.floor(y - sf.y0) * sf.width + Math.floor(x - sf.x0)] ?? 0;

  it('is the sprite\'s oval around a lone centre: wide, and flatter than wide', () => {
    const sf = lakeSurface([{ x: 20, y: 20 }], [], RX, RY);
    expect(alphaAt(sf, 20, 20)).toBe(1);
    expect(alphaAt(sf, 20 + RX - 2, 20)).toBe(1);
    expect(alphaAt(sf, 20, 20 + RY + 1.5)).toBe(0);
  });

  it('stretches along linked centres, so neighbouring pieces share one surface', () => {
    const linked = lakeSurface([{ x: 10, y: 20 }, { x: 40, y: 20 }], [[0, 1]], RX, RY);
    expect(alphaAt(linked, 25, 20)).toBe(1);
    expect(alphaAt(linked, 25, 20 + RY + 1.5)).toBe(0);
    const apart = lakeSurface([{ x: 10, y: 20 }, { x: 40, y: 20 }], [], RX, RY);
    expect(alphaAt(apart, 25, 20)).toBe(0);
  });

  it('tells for each pixel how far it lies from the shore', () => {
    const sf = lakeSurface([{ x: 20, y: 20 }], [], RX, RY);
    const insetAt = (x: number, y: number) => sf.inset[Math.floor(y - sf.y0) * sf.width + Math.floor(x - sf.x0)];
    expect(insetAt(20, 20)).toBeGreaterThan(insetAt(20 + RX - 2, 20));
    expect(insetAt(20 + RX - 2, 20)).toBeGreaterThan(0);
  });

  it('can wave its shore so a big lake does not look cut with a ruler, keeping its middle wet', () => {
    const centres = [{ x: 10, y: 20 }, { x: 70, y: 20 }];
    const straight = lakeSurface(centres, [[0, 1]], RX, RY);
    const wavy = lakeSurface(centres, [[0, 1]], RX, RY, { amount: 0.3, seed: 2 });
    const edgeRow = (sf: typeof straight) => [...Array(sf.width).keys()].map((x) => sf.alpha[Math.floor(20 + RY - 1 - sf.y0) * sf.width + x]);
    expect(edgeRow(wavy)).not.toEqual(edgeRow(straight));
    expect(alphaAt(wavy, 40, 20)).toBe(1);
  });

  it('fills between three mutually linked centres', () => {
    const sf = lakeSurface([{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 30, y: 50 }], [[0, 1], [1, 2], [0, 2]], RX, RY);
    expect(alphaAt(sf, 30, 23)).toBe(1); // the middle, far from every edge
  });
});
