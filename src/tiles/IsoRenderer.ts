import type { Pixel } from '../math/hex';
import { rgbToCss } from '../rendering/palette';
import type { Sprite, SpriteSet } from './placeholderSprites';
import type { Raster } from './raster';
import type { PropInstance } from './scatter';
import type { Scene, SideFace, WallKind } from './scene';

/** Scene → screen mapping: screen = offset + scene * scale. */
export interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

/** Wall textures per wall kind; kinds without one fall back to a flat colour. */
export type WallImages = Partial<Record<Exclude<WallKind, 'none'>, HTMLImageElement>>;

/** Headroom above the highest ground for props (trees), in hex radii. */
const PROP_HEADROOM = 1.2;
/** Height of the ground-coloured lip along a wall's top edge, in scene pixels. */
const LIP = 2.5;
/** A wall texture repeats horizontally about every this many hex radii. */
const WALL_REPEAT = 2.6;
/** Darkening per face: light comes from the top-left. */
const FACE_SHADE = { left: 0.1, right: 0.32 } as const;

export function fitTransform(scene: Scene, width: number, height: number, margin = 24): ViewTransform {
  const top = Math.min(0, ...scene.bands.map((b) => b.slice.top)) - scene.hexSize * PROP_HEADROOM;
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

function rasterCanvas(r: Raster): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, r.width);
  canvas.height = Math.max(1, r.height);
  if (r.width && r.height) {
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
  }
  return canvas;
}

/** Soft contact shadow, nudged right and down because light comes from the top-left. */
function drawShadow(ctx: CanvasRenderingContext2D, foot: Pixel, radius: number): void {
  ctx.fillStyle = 'rgba(30, 40, 20, 0.22)';
  ctx.beginPath();
  ctx.ellipse(foot.x + radius * 0.2, foot.y, radius, radius * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Draws a Scene: the slab faces under the map first, then band by band, back
 * to front, each band's terrain slice followed by the props standing in it.
 * Nearer terrain is drawn later and so hides what lies behind it.
 */
export class IsoRenderer {
  private readonly slices = new WeakMap<Scene, HTMLCanvasElement[]>();
  private readonly surfaces = new WeakMap<Raster, HTMLCanvasElement>();
  private readonly patterns = new Map<HTMLImageElement, CanvasPattern>();

  constructor(
    public sprites: SpriteSet,
    public walls: WallImages = {},
  ) {}

  draw(ctx: CanvasRenderingContext2D, scene: Scene, t: ViewTransform, opts: { grid?: boolean } = {}): void {
    const slices = this.sliceCanvases(scene);
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.scale, t.scale);
    ctx.lineWidth = 0.6;
    ctx.imageSmoothingQuality = 'high';
    for (const tile of scene.tiles) {
      for (const face of tile.faces) this.drawFace(ctx, scene.hexSize, face, FACE_SHADE[face.side]);
    }
    scene.bands.forEach((band, b) => {
      ctx.drawImage(slices[b], 0, band.slice.top);
      for (const p of band.props) this.drawProp(ctx, p);
    });
    if (opts.grid) for (const tile of scene.tiles) this.outline(ctx, tile.top);
    ctx.restore();
  }

  private sliceCanvases(scene: Scene): HTMLCanvasElement[] {
    let canvases = this.slices.get(scene);
    if (!canvases) {
      canvases = scene.bands.map((b) => rasterCanvas(b.slice.raster));
      this.slices.set(scene, canvases);
    }
    return canvases;
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

  /**
   * One prop, or a group of parts drawn as one object: every part back to
   * front, then the group's surface on top (a lake's water over all its pieces).
   */
  private drawProp(ctx: CanvasRenderingContext2D, p: PropInstance): void {
    const parts = (p.parts ?? [p]).map((part) => ({ part, ...this.sized(part) }));
    for (const { part, s, k } of parts) {
      if (s.shadow) drawShadow(ctx, part, s.shadow * k);
      this.drawSprite(ctx, part, s.image, s.width * k, s.height * k);
    }
    if (p.surface) {
      const { raster, x, y, height } = p.surface;
      ctx.drawImage(this.surfaceCanvas(raster), x, y, raster.width, height);
    }
  }

  private surfaceCanvas(r: Raster): HTMLCanvasElement {
    let canvas = this.surfaces.get(r);
    if (!canvas) this.surfaces.set(r, (canvas = rasterCanvas(r)));
    return canvas;
  }

  /** The prop's sprite variant and its scale (1 unless the prop asks for a height). */
  private sized(p: PropInstance): { s: Sprite; k: number } {
    const variants = this.sprites[p.kind];
    const s = variants[p.variant % variants.length];
    return { s, k: p.height ? p.height / s.height : 1 };
  }

  /** Draw an image with its bottom-centre on the prop's foot, mirrored if the prop says so. */
  private drawSprite(ctx: CanvasRenderingContext2D, p: PropInstance, image: CanvasImageSource, w: number, h: number): void {
    if (!p.flip) {
      ctx.drawImage(image, p.x - w / 2, p.y - h, w, h);
      return;
    }
    ctx.save();
    ctx.translate(p.x, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(image, -w / 2, p.y - h, w, h);
    ctx.restore();
  }

  private outline(ctx: CanvasRenderingContext2D, points: Pixel[]): void {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    tracePolygon(ctx, points);
    ctx.stroke();
  }
}
