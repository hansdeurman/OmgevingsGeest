import { describe, expect, it } from 'vitest';
import { faceRow, sampleStrip, type WallStrip } from '../wallStrip';
import { createRaster, setPixel } from '../raster';

/** A strip whose red channel is its row number: cap 0..4, top 5..19, band 20..39, foot 40..59. */
const strip: WallStrip = (() => {
  const image = createRaster(4, 60);
  for (let y = 0; y < 60; y++) for (let x = 0; x < 4; x++) setPixel(image, x, y, [y, x, 0], 255);
  return { image, lip: 5, from: 20, to: 40 };
})();
const rows = (h: number) => Array.from({ length: h }, (_, v) => faceRow(strip, v, h));

describe('faceRow', () => {
  it('starts every face with the top of the wall and ends it with the foot', () => {
    for (const h of [10, 35, 90]) {
      expect(rows(h)[0]).toBe(strip.lip);
      expect(rows(h)[h - 1]).toBe(59);
    }
  });

  it('repeats the middle band as often as a tall face needs', () => {
    const tall = rows(35 + 3 * 20);
    expect(tall.filter((r) => r === strip.from)).toHaveLength(3);
    expect(tall.every((r) => r >= strip.lip && r < 60)).toBe(true);
  });

  it('keeps a face exactly as tall as its parts without repeating the band', () => {
    expect(rows(35)).toEqual([...Array.from({ length: 15 }, (_, i) => 5 + i), ...Array.from({ length: 20 }, (_, i) => 40 + i)]);
  });

  it('cuts a short face from the top and the foot, never squashing them', () => {
    const short = rows(14);
    expect(short.slice(0, 6)).toEqual([5, 6, 7, 8, 9, 10]);
    expect(short.slice(-8)).toEqual([52, 53, 54, 55, 56, 57, 58, 59]);
  });
});

describe('sampleStrip', () => {
  it('repeats sideways and reads the requested row', () => {
    expect(sampleStrip(strip, 6, 12)).toEqual([12, 2, 0, 255]);
    expect(sampleStrip(strip, -1, 3)).toEqual([3, 3, 0, 255]);
  });
});
