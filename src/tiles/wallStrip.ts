import type { Raster } from './raster';

/**
 * A painted wall that stretches to any height without squashing: rows
 * [0, lip) are its capstone seen from above, [lip, from) the top of its face,
 * [from, to) a band that repeats seamlessly, [to, height) the foot. It
 * repeats sideways, so it can follow any shore.
 */
export interface WallStrip {
  image: Raster;
  lip: number;
  from: number;
  to: number;
}

/**
 * Strip row for row `v` of a face `h` rows tall (v = 0 just under the
 * capstone): the top as drawn, the foot at the bottom, the band repeated in
 * between. A face shorter than top and foot together keeps a share of each.
 */
export function faceRow(s: WallStrip, v: number, h: number): number {
  const [top, foot, band] = [s.from - s.lip, s.image.height - s.to, s.to - s.from];
  const fromFoot = h - v;
  if (h < top + foot) return v < Math.round((h * top) / (top + foot)) ? s.lip + v : s.image.height - fromFoot;
  if (v < top) return s.lip + v;
  if (fromFoot <= foot) return s.image.height - fromFoot;
  return s.from + ((v - top) % band);
}

/** Strip row for row `v` of a wall drawn with a capstone `cap` rows tall above a face `h` rows tall. */
export function wallRow(s: WallStrip, v: number, h: number, cap = s.lip): number {
  return v < cap ? s.lip - cap + v : faceRow(s, v - cap, h);
}

/** RGBA at column `u` (wrapping sideways) of strip row `row`. */
export function sampleStrip(s: WallStrip, u: number, row: number): [number, number, number, number] {
  const { width, height, data } = s.image;
  const x = ((Math.floor(u) % width) + width) % width;
  const i = (Math.min(height - 1, Math.max(0, Math.floor(row))) * width + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}
