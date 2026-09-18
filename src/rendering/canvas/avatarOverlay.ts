import { offsetToPixel } from '../../math/hex';
import { FIRE_DIRS, HEX_SPACING, type Projectile } from '../../game/avatar';

/** Live swipe feedback handed to the renderer while a drag is in progress. */
export interface SwipeAim {
  /** Raw drag vector in screen pixels (direction is all we use). */
  dx: number;
  dy: number;
  /** Snapped direction index, or -1 while the drag is inside the deadzone. */
  dirIndex: number;
}

/**
 * Draw the player stand-in: a filled disc with a bright ring so it reads
 * clearly on top of both terrain and the density backdrop.
 */
export function drawAvatar(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  hexSize: number,
  zoom: number,
): void {
  const c = offsetToPixel(col, row, hexSize);
  const radius = hexSize * 0.6;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Soft glow so the avatar is findable when zoomed out.
  ctx.shadowColor = 'rgba(120, 200, 255, 0.9)';
  ctx.shadowBlur = 10 / zoom;
  ctx.fillStyle = '#1b2a44';
  ctx.beginPath();
  ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.lineWidth = 2.2 / zoom;
  ctx.strokeStyle = '#8fd0ff';
  ctx.beginPath();
  ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#eaf6ff';
  ctx.beginPath();
  ctx.arc(c.x, c.y, radius * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Draw the twelve-way aim guide around the avatar while a swipe is active.
 * Every spoke is drawn faintly so the user can see the full set of legal
 * directions; the snapped one is highlighted with a full-length arrow.
 *
 * Spokes alternate between the two families and are styled accordingly:
 * even indices point at a neighbouring hex centre (through an edge), odd
 * indices run parallel to an edge.
 */
export function drawAimGuide(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  aim: SwipeAim,
  hexSize: number,
  zoom: number,
): void {
  const c = offsetToPixel(col, row, hexSize);
  const inner = hexSize * 0.9;
  const spoke = HEX_SPACING * 3.2;
  const active = aim.dirIndex;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let i = 0; i < FIRE_DIRS.length; i++) {
    const d = FIRE_DIRS[i];
    const isActive = i === active;
    const len = isActive ? spoke : spoke * 0.55;
    const x0 = c.x + d.x * inner;
    const y0 = c.y + d.y * inner;
    const x1 = c.x + d.x * (inner + len);
    const y1 = c.y + d.y * (inner + len);

    if (isActive) {
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2.6 / zoom;
      ctx.strokeStyle = '#8fd0ff';
    } else {
      ctx.globalAlpha = 0.34;
      ctx.lineWidth = 1.4 / zoom;
      // Through-edge spokes stay neutral; edge-parallel ones get a warmer
      // tint so the two families are tellable apart at a glance.
      ctx.strokeStyle = d.throughEdge ? '#cfe6ff' : '#ffd9a0';
    }

    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();

    if (isActive) {
      const head = hexSize * 1.1;
      const px = -d.y * head * 0.55;
      const py = d.x * head * 0.55;
      const bx = x1 - d.x * head;
      const by = y1 - d.y * head;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(bx + px, by + py);
      ctx.moveTo(x1, y1);
      ctx.lineTo(bx - px, by - py);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * Draw every in-flight shot as a bright head with a fading trail behind it.
 * Alpha ramps down over the projectile's lifetime so a shot visibly runs
 * out of steam as it reaches the end of its range.
 */
export function drawProjectiles(
  ctx: CanvasRenderingContext2D,
  shots: ReadonlyArray<Projectile>,
  hexSize: number,
  zoom: number,
): void {
  const headRadius = hexSize * 0.3;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const p of shots) {
    const fade = p.life > 0 ? Math.max(0, 1 - p.age / p.life) : 0;
    // Ease the fade so a shot stays crisp for most of its flight and only
    // dims near the end, instead of being half-transparent from the start.
    const alpha = 0.25 + 0.75 * Math.min(1, fade * 2);

    if (p.trail.length > 1) {
      ctx.globalAlpha = alpha * 0.45;
      ctx.lineWidth = headRadius * 1.1;
      ctx.strokeStyle = '#ffd9a0';
      ctx.beginPath();
      ctx.moveTo(p.trail[0].x, p.trail[0].y);
      for (let i = 1; i < p.trail.length; i++) ctx.lineTo(p.trail[i].x, p.trail[i].y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    ctx.globalAlpha = alpha;
    ctx.shadowColor = 'rgba(255, 200, 120, 0.9)';
    ctx.shadowBlur = 8 / zoom;
    ctx.fillStyle = '#fff2d6';
    ctx.beginPath();
    ctx.arc(p.x, p.y, headRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}
