import { describe, expect, it } from 'vitest';
import { getPixel } from '../../tiles/raster';
import { SHAPES } from '../cloudDeck';
import { cloudAtlas, paintCloud } from '../cloudSprites';

const [W, H] = [96, 64];

describe('paintCloud', () => {
  const cloud = paintCloud(W, H, 3, 'heap');
  const alpha = (x: number, y: number) => getPixel(cloud, x, y)[3];
  const light = (x: number, y: number) => getPixel(cloud, x, y).slice(0, 3).reduce((a, b) => a + b, 0) / 3;

  it('is a solid body with soft edges on a clear ground', () => {
    expect(alpha(W / 2, Math.round(H * 0.6))).toBe(255);
    for (const [x, y] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]]) expect(alpha(x, y)).toBe(0);
    const soft = Array.from({ length: W * H }, (_, i) => alpha(i % W, Math.floor(i / W))).filter((a) => a > 20 && a < 235);
    expect(soft.length).toBeGreaterThan(W);
  });

  it('is lit on top and darker underneath', () => {
    const column = Array.from({ length: H }, (_, y) => y).filter((y) => alpha(W / 2, y) === 255);
    const [top, bottom] = [column[0], column.at(-1)!];
    expect(light(W / 2, top + 2)).toBeGreaterThan(light(W / 2, bottom - 1));
  });

  it('holds no green: white, grey, blue-grey and lavender only', () => {
    for (let i = 0; i < W * H; i++) {
      const [r, g, b, a] = getPixel(cloud, i % W, Math.floor(i / W));
      if (a) expect(g).toBeLessThanOrEqual(Math.max(r, b) + 2);
    }
  });

  it('paints a rain bank wider than it is tall', () => {
    const bank = paintCloud(W, H, 3, 'bank');
    const rows = Array.from({ length: H }, (_, y) => y).filter((y) => getPixel(bank, W / 2, y)[3] > 128);
    const cols = Array.from({ length: W }, (_, x) => x).filter((x) => getPixel(bank, x, H / 2)[3] > 128);
    expect(cols.length).toBeGreaterThan(2 * rows.length);
  });
});

describe('cloudAtlas', () => {
  it('lays every shape side by side, each different', () => {
    const atlas = cloudAtlas(W, H);
    expect(atlas.width).toBe(W * SHAPES);
    expect(atlas.height).toBe(H);
    const cell = (k: number) => Array.from({ length: W }, (_, x) => getPixel(atlas, k * W + x, H / 2)[3]).join();
    expect(new Set(Array.from({ length: SHAPES }, (_, k) => cell(k))).size).toBe(SHAPES);
  });
});
