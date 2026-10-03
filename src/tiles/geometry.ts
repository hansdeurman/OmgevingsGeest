import { gridPixelBounds, hexCorners, offsetToPixel, type Pixel } from '../math/hex';

/**
 * Isometric-style view: the flat top-down map is squashed vertically and the
 * map sits on a slab whose front faces show below it.
 */
export interface IsoView {
  /** Vertical scale applied to the top-down map (1 = top-down). */
  squash: number;
  /** Height of the slab's front faces, in output pixels. */
  thickness: number;
}

/** Hex radius (px) at which textures and ground detail have their native size; at other sizes they scale along. */
export const ART_HEX = 40;

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

/** Top face corners in iso space, raised by `lift` pixels. */
export function isoTop(centre: Pixel, size: number, view: IsoView, lift = 0): Pixel[] {
  return hexCorners(centre.x, centre.y, size).map((p) => {
    const q = toIso(p, view);
    return { x: q.x, y: q.y - lift };
  });
}

/**
 * The column's visible front faces: [lower-left, lower-right], in iso space.
 * They run from the (lifted) top edge all the way down to the sea-level base;
 * lower neighbours drawn in front hide whatever part they cover.
 */
export function isoSideFaces(centre: Pixel, size: number, view: IsoView, lift = 0): [Pixel[], Pixel[]] {
  // hexCorners order: 1 = lower-right, 2 = bottom point, 3 = lower-left.
  const [, lowerRight, bottom, lowerLeft] = isoTop(centre, size, view, lift);
  const down = (p: Pixel): Pixel => ({ x: p.x, y: p.y + lift + view.thickness });
  return [
    [lowerLeft, bottom, down(bottom), down(lowerLeft)],
    [bottom, lowerRight, down(lowerRight), down(bottom)],
  ];
}
