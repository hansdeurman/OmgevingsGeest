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

// Pure mountain ramp: deep brown at sea level → white at the peaks.
const STOPS: Stop[] = [
  { h: 0.0, rgb: [58, 36, 22] },
  { h: 1.0, rgb: [255, 255, 255] },
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
