import type { Pixel } from '../math/hex';
import { rgbToCss } from '../rendering/palette';
import { isoTop } from './geometry';
import type { SpriteSet } from './placeholderSprites';
import type { Raster } from './raster';
import type { Scene } from './scene';

/** Scene → screen mapping: screen = offset + scene * scale. */
export interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

/** Headroom above the map for props on the back row, in hex radii. */
const PROP_HEADROOM = 1.1;

export function fitTransform(scene: Scene, width: number, height: number, margin = 24): ViewTransform {
  const top = -scene.hexSize * PROP_HEADROOM;
  const w = scene.frame.width;
  const h = scene.frame.height * scene.view.squash + scene.view.thickness - top;
  const scale = Math.min((width - 2 * margin) / w, (height - 2 * margin) / h);
  return { scale, x: (width - w * scale) / 2, y: (height - h * scale) / 2 - top * scale };
}

/** Top-down frame pixel → screen pixel. */
export function projectToScreen(scene: Scene, t: ViewTransform, p: Pixel): Pixel {
  return { x: t.x + p.x * t.scale, y: t.y + p.y * scene.view.squash * t.scale };
}

function fillPolygon(ctx: CanvasRenderingContext2D, points: Pixel[], color: string): void {
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.fill();
  ctx.stroke(); // hides hairline gaps between neighbouring faces
}

/** Draws a Scene: slab sides, squashed ground, then sprites back to front. */
export class IsoRenderer {
  private readonly groundCanvas = document.createElement('canvas');
  private groundOf: Raster | null = null;

  constructor(private readonly sprites: SpriteSet) {}

  draw(ctx: CanvasRenderingContext2D, scene: Scene, t: ViewTransform, opts: { grid?: boolean } = {}): void {
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.scale, t.scale);
    ctx.lineWidth = 0.6;
    for (const side of scene.sides) fillPolygon(ctx, side.points, rgbToCss(side.color));
    this.drawGround(ctx, scene);
    if (opts.grid) this.drawGrid(ctx, scene);
    for (const p of scene.props) {
      const variants = this.sprites[p.kind];
      const s = variants[p.variant % variants.length];
      ctx.drawImage(s.image, p.x - s.width / 2, p.y - s.height, s.width, s.height);
    }
    ctx.restore();
  }

  private drawGround(ctx: CanvasRenderingContext2D, scene: Scene): void {
    if (this.groundOf !== scene.ground) {
      const { width, height, data } = scene.ground;
      this.groundCanvas.width = width;
      this.groundCanvas.height = height;
      this.groundCanvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
      this.groundOf = scene.ground;
    }
    ctx.save();
    ctx.scale(1, scene.view.squash);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.groundCanvas, 0, 0);
    ctx.restore();
  }

  private drawGrid(ctx: CanvasRenderingContext2D, scene: Scene): void {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    for (const c of scene.centres) {
      const pts = isoTop(c, scene.hexSize, scene.view);
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
    }
  }
}
