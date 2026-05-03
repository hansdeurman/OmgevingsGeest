import type { World } from '../../world/World';
import type { WindField } from '../../airflow/WindField';
import { offsetToPixel } from '../../math/hex';

export interface AirflowOverlayParams {
  hexSize: number;
  /** Render an arrow every `stride` tiles in each axis. */
  stride: number;
  /** Pixels per unit of wind speed in arrow length. */
  arrowScale: number;
  /** Speed at which the colour ramp tops out (becomes red). */
  maxSpeed: number;
  /** Camera zoom — used to keep stroke widths consistent on screen. */
  zoom: number;
}

/**
 * Wind colour ramp: blue (calm) → green (medium) → red (strong).
 * Returns an `rgb(...)` string ready for ctx.strokeStyle.
 */
export function windColor(magnitude: number, maxSpeed: number): string {
  const t = Math.max(0, Math.min(1, magnitude / Math.max(0.0001, maxSpeed)));
  let r: number;
  let g: number;
  let b: number;
  if (t < 0.5) {
    const k = t * 2;
    r = lerp(60, 100, k);
    g = lerp(140, 220, k);
    b = lerp(255, 110, k);
  } else {
    const k = (t - 0.5) * 2;
    r = lerp(100, 240, k);
    g = lerp(220, 80, k);
    b = lerp(110, 60, k);
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Draw arrows for the wind field. The caller is expected to have already
 * applied the world-space transform (centre + zoom + grid offset) to ctx.
 */
export function drawAirflowOverlay(
  ctx: CanvasRenderingContext2D,
  world: World,
  field: WindField,
  params: AirflowOverlayParams,
): void {
  const { hexSize: size, zoom } = params;
  const stride = Math.max(1, params.stride | 0);

  // Stroke width and minimum head size in screen pixels (constant across zoom).
  const lineWidth = 1.4 / zoom;
  const minHead = 2 / zoom;

  // Cells we render an arrow for. Arrow length is capped to the cluster size
  // so neighbours don't overlap badly when the field is dense.
  const maxLen = size * stride * 1.4;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = lineWidth;

  for (let row = 0; row < world.height; row += stride) {
    for (let col = 0; col < world.width; col += stride) {
      const idx = row * world.width + col;
      const vx = field.vx[idx];
      const vy = field.vy[idx];
      const mag = Math.hypot(vx, vy);
      if (mag < 0.05) continue;

      const len = Math.min(maxLen, Math.max(size * 0.6, mag * params.arrowScale));
      const ang = Math.atan2(vy, vx);
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      const c = offsetToPixel(col, row, size);

      // Draw line + arrowhead from (-len/2) to (+len/2) along the wind dir,
      // computed inline to avoid the cost of save/translate/rotate per arrow.
      const halfLen = len * 0.5;
      const tipX = c.x + cos * halfLen;
      const tipY = c.y + sin * halfLen;
      const tailX = c.x - cos * halfLen;
      const tailY = c.y - sin * halfLen;

      const head = Math.max(minHead, len * 0.32);
      // Perpendicular components for the head wings.
      const px = -sin * head * 0.55;
      const py = cos * head * 0.55;
      // A point slightly back from the tip along the shaft.
      const backX = tipX - cos * head;
      const backY = tipY - sin * head;

      ctx.strokeStyle = windColor(mag, params.maxSpeed);
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(backX + px, backY + py);
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(backX - px, backY - py);
      ctx.stroke();
    }
  }
}
