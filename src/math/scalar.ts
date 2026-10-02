/** Small scalar helpers shared by generation and rendering code. */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Hermite ramp from 0 (at e0) to 1 (at e1). */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Straight lines through `points` ([x, y], x ascending), level beyond the ends. */
export function piecewise(points: readonly (readonly [number, number])[]): (x: number) => number {
  return (x) => {
    if (x <= points[0][0]) return points[0][1];
    for (let k = 1; k < points.length; k++) {
      const [x1, y1] = points[k];
      if (x > x1) continue;
      const [x0, y0] = points[k - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
    return points[points.length - 1][1];
  };
}
