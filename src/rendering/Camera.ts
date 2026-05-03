/**
 * Pan/zoom camera in screen-space pixels. The renderer translates by (x, y)
 * after centring the world, then scales by zoom.
 */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;

  panBy(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
  }

  zoomAt(screenX: number, screenY: number, factor: number, centerX: number, centerY: number): void {
    // Keep the world point under the cursor stationary while zooming.
    const worldX = (screenX - centerX - this.x) / this.zoom;
    const worldY = (screenY - centerY - this.y) / this.zoom;
    this.zoom = Math.max(0.1, Math.min(8, this.zoom * factor));
    this.x = screenX - centerX - worldX * this.zoom;
    this.y = screenY - centerY - worldY * this.zoom;
  }
}
