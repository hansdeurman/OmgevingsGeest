/**
 * Between places on the map (in hex spacings, as creatures and the avatar
 * have them), the flat map's frame (px, hex (0, 0) at (ox, oy)) and the
 * screen, as the view shows the frame: scaled, moved and squashed.
 */
export interface MapFrame {
  ox: number;
  oy: number;
  /** Frame px per hex spacing. */
  spacing: number;
}

export interface ScreenView {
  scale: number;
  x: number;
  y: number;
  squash: number;
}

export const mapToFrame = (f: MapFrame, x: number, y: number) => ({ x: f.ox + x * f.spacing, y: f.oy + y * f.spacing });
export const frameToMap = (f: MapFrame, x: number, y: number) => ({ x: (x - f.ox) / f.spacing, y: (y - f.oy) / f.spacing });

/** The frame px a screen px shows, on the ground at sea level. */
export const screenToFrame = (v: ScreenView, x: number, y: number) => ({ x: (x - v.x) / v.scale, y: (y - v.y) / v.scale / v.squash });

/** The place on the map a screen px shows. */
export const screenToMap = (f: MapFrame, v: ScreenView, x: number, y: number) => {
  const p = screenToFrame(v, x, y);
  return frameToMap(f, p.x, p.y);
};
