import { describe, expect, it } from 'vitest';
import { frameToMap, mapToFrame, screenToMap } from '../mapView';

const frame = { ox: 17, oy: 20, spacing: 34.6 };
const view = { scale: 0.8, x: 40, y: 12, squash: 0.65 };

describe('mapView', () => {
  it('goes from the map to the frame and back', () => {
    const p = mapToFrame(frame, 3.5, 2);
    expect(p).toEqual({ x: 17 + 3.5 * 34.6, y: 20 + 2 * 34.6 });
    expect(frameToMap(frame, p.x, p.y).x).toBeCloseTo(3.5);
  });

  it('finds the place on the map a point on screen shows, as the view projects it', () => {
    const p = mapToFrame(frame, 4, 3);
    const screen = { x: view.x + p.x * view.scale, y: view.y + p.y * view.squash * view.scale };
    const back = screenToMap(frame, view, screen.x, screen.y);
    expect(back.x).toBeCloseTo(4);
    expect(back.y).toBeCloseTo(3);
  });
});
