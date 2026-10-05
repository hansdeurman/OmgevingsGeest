/**
 * The wind made visible: an arrow on every hex, along the wind there,
 * longer and warmer in colour the harder it blows, coloured by its force
 * on the Beaufort scale, with a key.
 */

/** Wind speed (m/s, roughly) of one hex spacing per step. */
export const METRES_PER_SECOND = 25;

/** The Beaufort force (0–12) of a wind this fast (m/s): v = 0.836 B^1.5. */
export const beaufort = (ms: number) => Math.min(12, Math.round(Math.cbrt((ms / 0.836) ** 2)));

/** Colour per Beaufort force: calm pale, a breeze blue to green, a gale orange to red. */
const COLOURS = ['#b8c4cf', '#a4c8e0', '#7fc4ec', '#5ab8e8', '#4fcf96', '#a6dc4c', '#f0d34a', '#f5a443', '#ef7340', '#e5483f', '#c9304f', '#a62a6a', '#7d2b8c'];
export const forceColour = (force: number) => COLOURS[Math.max(0, Math.min(12, force))];

export interface Arrow {
  /** Foot (canvas px) and the arrow's run to its head. */
  x: number;
  y: number;
  dx: number;
  dy: number;
  force: number;
}

/** Where the map is on the canvas: canvas px = offset + frame px (y squashed) * scale. */
export interface MapView {
  scale: number;
  x: number;
  y: number;
  squash: number;
}

/** An arrow this long (in hex spacings) for the strongest wind, shorter for weaker. */
const LONGEST = 0.85;
/** The wind (hex spacings per step) the longest arrow stands for. */
const STRONG = 0.5;

/** An arrow per hex of a `windX`/`windY` field (hex spacings per step), centred on the hex, on the ground as the view shows it. */
export function windArrows(field: { windX: ArrayLike<number>; windY: ArrayLike<number> }, centre: (i: number) => { x: number; y: number }, spacing: number, view: MapView): Arrow[] {
  return Array.from({ length: field.windX.length }, (_, i) => {
    const [wx, wy] = [field.windX[i], field.windY[i]];
    const speed = Math.hypot(wx, wy);
    const length = (Math.min(1, speed / STRONG) * LONGEST * spacing) / (speed || 1);
    const [dx, dy] = [wx * length * view.scale, wy * length * view.squash * view.scale];
    const c = centre(i);
    return { x: view.x + c.x * view.scale - dx / 2, y: view.y + c.y * view.squash * view.scale - dy / 2, dx, dy, force: beaufort(speed * METRES_PER_SECOND) };
  });
}

/** Draw `arrows` and, at (keyX, keyY), a key of the forces. */
export function drawWind(ctx: CanvasRenderingContext2D, arrows: readonly Arrow[], key: { x: number; y: number }): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const a of arrows) {
    const length = Math.hypot(a.dx, a.dy);
    if (length < 1.5) {
      ctx.fillStyle = forceColour(a.force);
      ctx.beginPath();
      ctx.arc(a.x, a.y, 1.6, 0, 2 * Math.PI);
      ctx.fill();
      continue;
    }
    const [ux, uy] = [a.dx / length, a.dy / length];
    const head = Math.min(7, 2.5 + length * 0.3);
    const [hx, hy] = [a.x + a.dx, a.y + a.dy];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(hx, hy);
    ctx.moveTo(hx - ux * head - uy * head * 0.6, hy - uy * head + ux * head * 0.6);
    ctx.lineTo(hx, hy);
    ctx.lineTo(hx - ux * head + uy * head * 0.6, hy - uy * head - ux * head * 0.6);
    ctx.strokeStyle = 'rgba(10, 14, 22, 0.55)';
    ctx.lineWidth = 3.4;
    ctx.stroke();
    ctx.strokeStyle = forceColour(a.force);
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
  drawKey(ctx, arrows, key);
  ctx.restore();
}

/** The key: the forces blowing now, each with its colour. */
function drawKey(ctx: CanvasRenderingContext2D, arrows: readonly Arrow[], at: { x: number; y: number }): void {
  const forces = [...new Set(arrows.map((a) => a.force))].sort((a, b) => a - b);
  const [row, width] = [16, 132];
  const height = 26 + forces.length * row;
  ctx.fillStyle = 'rgba(20, 20, 28, 0.85)';
  ctx.beginPath();
  ctx.roundRect(at.x, at.y, width, height, 8);
  ctx.fill();
  ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
  ctx.fillStyle = '#e4e4ec';
  ctx.fillText('Wind force (Bft)', at.x + 10, at.y + 17);
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
  forces.forEach((f, k) => {
    const y = at.y + 26 + k * row;
    ctx.fillStyle = forceColour(f);
    ctx.fillRect(at.x + 10, y + 3, 18, 8);
    ctx.fillStyle = '#c2c2cc';
    ctx.fillText(`${f} · ${Math.round(0.836 * f ** 1.5)} m/s`, at.x + 36, y + 11);
  });
}
