import { gridPixelBounds, hexCorners, offsetToPixel, type Pixel } from '../math/hex';

/**
 * Isometric-style view: the flat top-down map is squashed vertically and each
 * hex becomes a slab whose two front faces show below it.
 */
export interface IsoView {
  /** Vertical scale applied to the top-down map (1 = top-down). */
  squash: number;
  /** Height of the slab's front faces, in output pixels. */
  thickness: number;
}

/** Top-down pixel frame of a grid; (ox, oy) is where hex (0,0)'s centre lands. */
export interface GridFrame {
  width: number;
  height: number;
  ox: number;
  oy: number;
}

export function gridFrame(cols: number, rows: number, size: number): GridFrame {
  const b = gridPixelBounds(cols, rows, size);
  return {
    width: Math.ceil(b.x),
    height: Math.ceil(b.y),
    ox: (Math.sqrt(3) / 2) * size,
    oy: size,
  };
}

/** Hex centre in frame coordinates. */
export function frameCentre(col: number, row: number, size: number, frame: GridFrame): Pixel {
  const p = offsetToPixel(col, row, size);
  return { x: p.x + frame.ox, y: p.y + frame.oy };
}

export function toIso(p: Pixel, view: IsoView): Pixel {
  return { x: p.x, y: p.y * view.squash };
}

export function isoTop(centre: Pixel, size: number, view: IsoView): Pixel[] {
  return hexCorners(centre.x, centre.y, size).map((p) => toIso(p, view));
}

/** The slab's visible front faces: [lower-left, lower-right], in iso space. */
export function isoSideFaces(centre: Pixel, size: number, view: IsoView): [Pixel[], Pixel[]] {
  // hexCorners order: 1 = lower-right, 2 = bottom point, 3 = lower-left.
  const [, lowerRight, bottom, lowerLeft] = isoTop(centre, size, view);
  const down = (p: Pixel): Pixel => ({ x: p.x, y: p.y + view.thickness });
  return [
    [lowerLeft, bottom, down(bottom), down(lowerLeft)],
    [bottom, lowerRight, down(lowerRight), down(bottom)],
  ];
}
