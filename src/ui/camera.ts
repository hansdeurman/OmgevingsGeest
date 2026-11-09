/**
 * The view onto the map: the whole map fitted to the screen, or zoomed in
 * on a spot of it (in the flat map's frame px), following the avatar or
 * panned by hand; never further out than the whole map, nor so far over
 * that the view leaves the map.
 */
export interface Camera {
  /** 1: the whole map; more: that many times closer. */
  zoom: number;
  /** Whether it keeps the avatar in the middle. */
  follow: boolean;
  /** The spot in the middle of the view (frame px). */
  centre: { x: number; y: number };
}

export interface Transform {
  scale: number;
  x: number;
  y: number;
}

export const ZOOM = { least: 1, most: 4 };

const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));

/** Where the view shows the map: `fit` (the whole map) zoomed in on the camera's centre, kept over the map. */
export function cameraTransform(fit: Transform, cam: Camera, view: { width: number; height: number }, frame: { width: number; height: number }, squash: number): Transform {
  if (cam.zoom <= ZOOM.least) return fit;
  const scale = fit.scale * cam.zoom;
  const [halfW, halfH] = [view.width / 2 / scale, view.height / 2 / (scale * squash)];
  const cx = clamp(cam.centre.x, halfW, frame.width - halfW);
  const cy = clamp(cam.centre.y, halfH, frame.height - halfH);
  return { scale, x: view.width / 2 - cx * scale, y: view.height / 2 - cy * squash * scale };
}

/** Zoom by `factor`, within bounds. */
export const zoomBy = (cam: Camera, factor: number) => (cam.zoom = Math.max(ZOOM.least, Math.min(ZOOM.most, cam.zoom * factor)));

/** Move the view by a drag of (dx, dy) screen px: the map goes with the finger, and the camera stops following. */
export function pan(cam: Camera, dx: number, dy: number, scale: number, squash: number): void {
  cam.centre = { x: cam.centre.x - dx / scale, y: cam.centre.y - dy / (scale * squash) };
  cam.follow = false;
}

/** Ease the camera's centre a share `ease` of the way towards `to`. */
export function ease(cam: Camera, to: { x: number; y: number }, share: number): void {
  cam.centre = { x: cam.centre.x + (to.x - cam.centre.x) * share, y: cam.centre.y + (to.y - cam.centre.y) * share };
}
