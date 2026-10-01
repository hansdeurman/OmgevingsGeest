import type { Pixel } from '../math/hex';
import { rgbToCss } from '../rendering/palette';
import type { SpriteSet } from './placeholderSprites';
import type { Raster } from './raster';
import type { PropInstance } from './scatter';
import type { Scene, SideFace, TileDraw, WallKind } from './scene';

/** Scene → screen mapping: screen = offset + scene * scale. */
export interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

/** Wall textures per wall kind; kinds without one fall back to a flat colour. */
export type WallImages = Partial<Record<Exclude<WallKind, 'none'>, HTMLImageElement>>;

/** Headroom above the map for the tallest props (mountains), in hex radii. */
const PROP_HEADROOM = 1.9;
/** Height of the ground-coloured lip along a wall's top edge, in scene pixels. */
const LIP = 2.5;
/** A wall texture repeats horizontally about every this many hex radii. */
const WALL_REPEAT = 2.6;
/** Darkening per face, [lower-left, lower-right]: light comes from the top-left. */
const FACE_SHADE = [0.1, 0.32];

export const maxLift = (scene: Scene) => Math.max(0, ...scene.rows.flatMap((r) => r.tiles.map((t) => t.lift)));

export function fitTransform(scene: Scene, width: number, height: number, margin = 24): ViewTransform {
  const top = -(scene.hexSize * PROP_HEADROOM + maxLift(scene));
  const w = scene.frame.width;
  const h = scene.frame.height * scene.view.squash + scene.view.thickness - top;
  const scale = Math.min((width - 2 * margin) / w, (height - 2 * margin) / h);
  return { scale, x: (width - w * scale) / 2, y: (height - h * scale) / 2 - top * scale };
}

/** Top-down frame pixel (raised by `lift`) → screen pixel. */
export function projectToScreen(scene: Scene, t: ViewTransform, p: Pixel, lift = 0): Pixel {
  return { x: t.x + p.x * t.scale, y: t.y + (p.y * scene.view.squash - lift) * t.scale };
}

function tracePolygon(ctx: CanvasRenderingContext2D, points: Pixel[]): void {
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

/** Push every vertex `px` pixels away from the centroid, so neighbouring clips overlap seamlessly. */
function grow(points: Pixel[], px: number): Pixel[] {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  return points.map((p) => {
    const d = Math.hypot(p.x - cx, p.y - cy) || 1;
    return { x: cx + (p.x - cx) * (1 + px / d), y: cy + (p.y - cy) * (1 + px / d) };
  });
}

/** Soft contact shadow, nudged right and down because light comes from the top-left. */
function drawShadow(ctx: CanvasRenderingContext2D, foot: Pixel, radius: number): void {
  ctx.fillStyle = 'rgba(30, 40, 20, 0.22)';
  ctx.beginPath();
  ctx.ellipse(foot.x + radius * 0.2, foot.y, radius, radius * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Draws a Scene row by row, back to front: each tile's walls and lifted
 * ground patch, then the row's sprites. Higher land in front is drawn later
 * and so hides what lies behind it.
 */
export class IsoRenderer {
  private readonly groundCanvas = document.createElement('canvas');
  private groundOf: Raster | null = null;
  private readonly patterns = new Map<HTMLImageElement, CanvasPattern>();

  constructor(
    public sprites: SpriteSet,
    public walls: WallImages = {},
  ) {}

  draw(ctx: CanvasRenderingContext2D, scene: Scene, t: ViewTransform, opts: { grid?: boolean } = {}): void {
    this.syncGround(scene.ground);
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.scale, t.scale);
    ctx.lineWidth = 0.6;
    ctx.imageSmoothingQuality = 'high';
    for (const row of scene.rows) {
      for (const tile of row.tiles) {
        tile.faces.forEach((face, i) => this.drawFace(ctx, scene.hexSize, face, FACE_SHADE[i]));
        this.drawTop(ctx, scene.view.squash, tile);
      }
      if (opts.grid) for (const tile of row.tiles) this.outline(ctx, tile.top);
      for (const p of row.props) this.drawProp(ctx, p);
    }
    ctx.restore();
  }

  private syncGround(ground: Raster): void {
    if (this.groundOf === ground) return;
    const { width, height, data } = ground;
    this.groundCanvas.width = width;
    this.groundCanvas.height = height;
    this.groundCanvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
    this.groundOf = ground;
  }

  /** This tile's patch of the shared ground image, squashed and raised by its lift. */
  private drawTop(ctx: CanvasRenderingContext2D, squash: number, tile: TileDraw): void {
    const xs = tile.top.map((p) => p.x);
    const ys = tile.top.map((p) => p.y);
    const x0 = Math.floor(Math.min(...xs)) - 1;
    const x1 = Math.ceil(Math.max(...xs)) + 1;
    const y0 = Math.floor(Math.min(...ys)) - 1;
    const y1 = Math.ceil(Math.max(...ys)) + 1;
    ctx.save();
    tracePolygon(ctx, grow(tile.top, 0.6));
    ctx.clip();
    const sy0 = (y0 + tile.lift) / squash;
    const sy1 = (y1 + tile.lift) / squash;
    ctx.drawImage(this.groundCanvas, x0, sy0, x1 - x0, sy1 - sy0, x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
  }

  private drawFace(ctx: CanvasRenderingContext2D, hexSize: number, face: SideFace, darken: number): void {
    const image = face.wall === 'none' ? undefined : this.walls[face.wall];
    const colour = rgbToCss(face.color);
    tracePolygon(ctx, face.points);
    if (!image) {
      ctx.fillStyle = ctx.strokeStyle = colour;
      ctx.fill();
      ctx.stroke(); // hides hairline gaps between neighbouring faces
      return;
    }
    ctx.fillStyle = ctx.strokeStyle = this.pattern(ctx, image, hexSize);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = `rgba(0, 0, 0, ${darken})`;
    ctx.fill();
    // A thin strip of the ground colour along the top edge, like turf overhanging the wall.
    const [a, b] = face.points;
    tracePolygon(ctx, [a, b, { x: b.x, y: b.y + LIP }, { x: a.x, y: a.y + LIP }]);
    ctx.fillStyle = colour;
    ctx.fill();
  }

  /** Wall patterns are anchored to the scene, so strata line up across neighbouring columns. */
  private pattern(ctx: CanvasRenderingContext2D, image: HTMLImageElement, hexSize: number): CanvasPattern {
    let p = this.patterns.get(image);
    if (!p) {
      p = ctx.createPattern(image, 'repeat')!;
      const k = (WALL_REPEAT * hexSize) / image.naturalWidth;
      p.setTransform(new DOMMatrix().scale(k));
      this.patterns.set(image, p);
    }
    return p;
  }

  private drawProp(ctx: CanvasRenderingContext2D, p: PropInstance): void {
    const variants = this.sprites[p.kind];
    const s = variants[p.variant % variants.length];
    if (s.shadow) drawShadow(ctx, p, s.shadow);
    ctx.drawImage(s.image, p.x - s.width / 2, p.y - s.height, s.width, s.height);
  }

  private outline(ctx: CanvasRenderingContext2D, points: Pixel[]): void {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    tracePolygon(ctx, points);
    ctx.stroke();
  }
}
