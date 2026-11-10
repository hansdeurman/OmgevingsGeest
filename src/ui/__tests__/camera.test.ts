import { describe, expect, it } from 'vitest';
import { cameraTransform, coverZoom, ease, mostZoom, pan, ZOOM, zoomBy, type Camera } from '../camera';

const fit = { scale: 0.25, x: 20, y: 300 };
const view = { width: 400, height: 700 };
const frame = { width: 1200, height: 900 };
const squash = 0.65;
const cam = (change: Partial<Camera> = {}): Camera => ({ zoom: 2, follow: true, centre: { x: 600, y: 450 }, ...change });
const onScreen = (t: { scale: number; x: number; y: number }, p: { x: number; y: number }) => ({ x: t.x + p.x * t.scale, y: t.y + p.y * squash * t.scale });

describe('cameraTransform', () => {
  it('shows the whole map at zoom 1', () => {
    expect(cameraTransform(fit, cam({ zoom: 1 }), view, frame, squash)).toBe(fit);
  });

  it('zoomed in, puts its centre in the middle of the view, that much closer', () => {
    const t = cameraTransform(fit, cam(), view, frame, squash);
    expect(t.scale).toBe(0.5);
    const mid = onScreen(t, { x: 600, y: 450 });
    expect(mid.x).toBeCloseTo(200);
    expect(mid.y).toBeCloseTo(350);
  });

  it('keeps the view over the map near its edge, and the map in the middle where it is smaller than the view', () => {
    const t = cameraTransform(fit, cam({ zoom: 4, centre: { x: 0, y: 0 } }), view, frame, squash);
    const [corner, far] = [onScreen(t, { x: 0, y: 0 }), onScreen(t, { x: frame.width, y: frame.height })];
    expect(corner.x).toBeCloseTo(0);
    expect(corner.y).toBeCloseTo(view.height - far.y);
  });
});

describe('moving the camera', () => {
  it('zooms within bounds', () => {
    const c = cam();
    zoomBy(c, 100);
    expect(c.zoom).toBe(ZOOM.most);
    zoomBy(c, 0.0001);
    expect(c.zoom).toBe(ZOOM.least);
  });

  it('zooms closer on a big map, until it is shown about as big as it is painted', () => {
    expect(mostZoom({ ...fit, scale: 0.5 })).toBe(ZOOM.most);
    expect(mostZoom({ ...fit, scale: 0.05 })).toBeGreaterThan(20);
    const c = cam();
    zoomBy(c, 100, mostZoom({ ...fit, scale: 0.05 }));
    expect(c.zoom * 0.05).toBeLessThan(1.5);
    expect(c.zoom).toBeGreaterThan(ZOOM.most);
  });

  it('knows the zoom that leaves no empty bands beside the map', () => {
    const z = coverZoom(fit, frame, view, squash);
    const t = cameraTransform(fit, cam({ zoom: z }), view, frame, squash);
    expect(frame.width * t.scale).toBeGreaterThanOrEqual(view.width - 1e-6);
    expect(frame.height * squash * t.scale).toBeGreaterThanOrEqual(view.height - 1e-6);
    expect(Math.min(frame.width * t.scale - view.width, frame.height * squash * t.scale - view.height)).toBeCloseTo(0);
  });

  it('pans with the finger, and stops following', () => {
    const c = cam();
    pan(c, 50, 0, 0.5, squash);
    expect(c.centre.x).toBe(500);
    expect(c.follow).toBe(false);
  });

  it('eases towards a spot', () => {
    const c = cam({ centre: { x: 0, y: 0 } });
    ease(c, { x: 100, y: 10 }, 0.5);
    expect(c.centre).toEqual({ x: 50, y: 5 });
  });
});
