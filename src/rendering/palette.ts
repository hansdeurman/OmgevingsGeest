/**
 * Height palette. Stops are sorted by elevation; we lerp between them.
 * Returning [r, g, b] keeps the renderer free to compose colours (for
 * shading, alpha, etc.) without re-parsing strings.
 */

export type RGB = [number, number, number];

interface Stop {
  h: number;
  rgb: RGB;
}

const STOPS: Stop[] = [
  { h: 0.0, rgb: [22, 38, 70] },     // deep
  { h: 0.25, rgb: [46, 86, 132] },   // shallow
  { h: 0.34, rgb: [212, 200, 150] }, // sand
  { h: 0.45, rgb: [96, 142, 78] },   // grass
  { h: 0.6, rgb: [120, 96, 60] },    // hills
  { h: 0.78, rgb: [120, 116, 110] }, // stone
  { h: 0.92, rgb: [220, 220, 225] }, // snow
  { h: 1.0, rgb: [255, 255, 255] },  // peak
];

function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

export function heightToRGB(h: number): RGB {
  const v = Math.max(0, Math.min(1, h));
  for (let i = 1; i < STOPS.length; i++) {
    if (v <= STOPS[i].h) {
      const a = STOPS[i - 1];
      const b = STOPS[i];
      const t = (v - a.h) / (b.h - a.h || 1);
      return mix(a.rgb, b.rgb, t);
    }
  }
  return STOPS[STOPS.length - 1].rgb;
}

export function rgbToCss([r, g, b]: RGB): string {
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

/** Multiply RGB by a scalar in [0, 2], clamped. */
export function shade([r, g, b]: RGB, k: number): RGB {
  return [
    Math.max(0, Math.min(255, r * k)),
    Math.max(0, Math.min(255, g * k)),
    Math.max(0, Math.min(255, b * k)),
  ];
}
