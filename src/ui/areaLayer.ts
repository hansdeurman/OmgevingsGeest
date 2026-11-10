import type { Vec } from './lasso';

/** What drawing an area takes of a canvas. */
export type AreaCanvas = Pick<CanvasRenderingContext2D, 'beginPath' | 'moveTo' | 'lineTo' | 'closePath' | 'fill' | 'stroke' | 'setLineDash'> & {
  fillStyle: CanvasRenderingContext2D['fillStyle'];
  strokeStyle: CanvasRenderingContext2D['strokeStyle'];
  lineWidth: number;
};

const LOOK = { line: '#ffd23f', fill: 'rgba(255, 210, 63, 0.14)', width: 2, dash: [7, 5] };

/** An area on the map (`points` in map units, put on the screen by `toScreen`): a dashed line while it is drawn, outlined and lightly filled once `closed`. */
export function drawArea(ctx: AreaCanvas, points: readonly Vec[], toScreen: (x: number, y: number) => Vec, closed: boolean): void {
  if (points.length < 2) return;
  ctx.beginPath();
  points.forEach((p, k) => {
    const s = toScreen(p.x, p.y);
    if (k) ctx.lineTo(s.x, s.y);
    else ctx.moveTo(s.x, s.y);
  });
  if (closed) {
    ctx.closePath();
    ctx.fillStyle = LOOK.fill;
    ctx.fill();
  }
  ctx.setLineDash(LOOK.dash);
  ctx.lineWidth = LOOK.width;
  ctx.strokeStyle = LOOK.line;
  ctx.stroke();
  ctx.setLineDash([]);
}
