import type { World } from '../../world/World';
import type { WindField } from '../../airflow/WindField';
import type { WindSource } from '../../airflow/sources';
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

/**
 * Draw user-placed wind sources: a small circle at the source cell and an
 * arrow showing the vector being injected. Lives on top of the wind field
 * so it stays visible regardless of arrow density.
 */
export function drawWindSources(
  ctx: CanvasRenderingContext2D,
  sources: ReadonlyArray<WindSource>,
  hexSize: number,
  zoom: number,
  maxSpeed: number,
): void {
  const lineWidth = 1.6 / zoom;
  const ringWidth = 2 / zoom;
  const radius = hexSize * 0.55;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const s of sources) {
    const c = offsetToPixel(s.col, s.row, hexSize);
    const mag = Math.hypot(s.vx, s.vy);
    const color = windColor(mag, maxSpeed);

    // Outer ring marks the source location.
    ctx.lineWidth = ringWidth;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = color;
    ctx.lineWidth = ringWidth * 0.8;
    ctx.beginPath();
    ctx.arc(c.x, c.y, radius * 0.7, 0, Math.PI * 2);
    ctx.stroke();

    // Direction arrow.
    if (mag > 0.001) {
      const ang = Math.atan2(s.vy, s.vx);
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      const len = Math.max(hexSize, Math.min(hexSize * 4, mag * 8));
      const tipX = c.x + cos * len;
      const tipY = c.y + sin * len;
      const head = Math.max(2 / zoom, hexSize * 0.6);
      const px = -sin * head * 0.6;
      const py = cos * head * 0.6;
      const backX = tipX - cos * head;
      const backY = tipY - sin * head;

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = lineWidth + 1.2 / zoom;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(backX + px, backY + py);
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(backX - px, backY - py);
      ctx.stroke();

      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(backX + px, backY + py);
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(backX - px, backY - py);
      ctx.stroke();
    }
  }
}

/**
 * Draw an in-progress source preview while the user is dragging. Same shape
 * as a finalised source but rendered semi-transparent so it's visibly draft.
 */
export function drawSourcePreview(
  ctx: CanvasRenderingContext2D,
  start: { x: number; y: number },
  end: { x: number; y: number },
  hexSize: number,
  zoom: number,
): void {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 2 / zoom;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#ffffff';

  ctx.beginPath();
  ctx.arc(start.x, start.y, hexSize * 0.55, 0, Math.PI * 2);
  ctx.stroke();

  if (Math.hypot(dx, dy) > 0.5) {
    const tipX = end.x;
    const tipY = end.y;
    const ang = Math.atan2(dy, dx);
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const head = Math.max(2 / zoom, hexSize * 0.7);
    const pxW = -sin * head * 0.6;
    const pyW = cos * head * 0.6;
    const backX = tipX - cos * head;
    const backY = tipY - sin * head;

    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(backX + pxW, backY + pyW);
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(backX - pxW, backY - pyW);
    ctx.stroke();
  }
  ctx.restore();
}
