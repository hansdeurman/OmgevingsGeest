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

const SHADOW = 'rgba(30, 40, 20, 0.22)';

/** Soft contact shadows of `props`, nudged right and down because light comes from the top-left: one path, filled once. */
function drawShadows(ctx: CanvasRenderingContext2D, shadows: readonly { foot: Pixel; radius: number }[]): void {
  if (!shadows.length) return;
  ctx.fillStyle = SHADOW;
  ctx.beginPath();
  for (const { foot, radius } of shadows) {
    const x = foot.x + radius * 0.2;
    ctx.moveTo(x + radius, foot.y);
    ctx.ellipse(x, foot.y, radius, radius * 0.38, 0, 0, Math.PI * 2);
  }
  ctx.fill();
}

/**
 * Draws a Scene: the slab faces under the map first, then band by band, back
 * to front, each band's terrain slice followed by the props standing in it.
 * Nearer terrain is drawn later and so hides what lies behind it.
 */
export class IsoRenderer {
  /** Canvases per raster (terrain slices, painted lakes), shared by scenes that share the raster. */
  private readonly canvases = new WeakMap<Raster, HTMLCanvasElement>();
  private readonly patterns = new Map<HTMLImageElement, CanvasPattern>();
  /** The flat map's faces and props as last drawn: redrawn only when they, or the view, change. */
  private layer?: { canvas: HTMLCanvasElement; bands: Scene['bands']; tiles: Scene['tiles']; key: string };

  constructor(
    public sprites: SpriteSet,
    public walls: WallImages = {},
  ) {}

  /** `ground: false` leaves the ground out (it is drawn elsewhere, on the GPU, under this canvas). */
  draw(ctx: CanvasRenderingContext2D, scene: Scene, t: ViewTransform, opts: { grid?: boolean; ground?: boolean } = {}): void {
    const ground = opts.ground ?? true;
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.scale, t.scale);
    ctx.lineWidth = 0.6;
    ctx.imageSmoothingQuality = 'high';
    if (scene.flat) {
      // Nothing is raised on the flat map: the ground, then everything on it, which mostly stays the same from frame to frame.
      if (ground) ctx.drawImage(this.canvasOf(scene.flat), 0, 0);
      const layer = this.layerOf(ctx, scene);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(layer, 0, 0);
      ctx.restore();
    } else {
      this.drawFaces(ctx, scene);
      scene.bands.forEach((band) => {
        if (ground) ctx.drawImage(this.canvasOf(band.slice.raster), 0, band.slice.top);
        this.drawProps(ctx, band.props);
      });
    }
    if (opts.grid) for (const tile of scene.tiles) this.outline(ctx, tile.top);
    ctx.restore();
  }

  /** The flat map's faces and props, drawn with `ctx`'s view onto a canvas of its size, kept while they and the view stay. */
  private layerOf(ctx: CanvasRenderingContext2D, scene: Scene): HTMLCanvasElement {
    const m = ctx.getTransform();
    const key = [ctx.canvas.width, ctx.canvas.height, m.a, m.d, m.e, m.f].join();
    const l = this.layer;
    if (l && l.bands === scene.bands && l.tiles === scene.tiles && l.key === key) return l.canvas;
    const start = performance.now();
    const canvas = l?.canvas ?? document.createElement('canvas');
    [canvas.width, canvas.height] = [ctx.canvas.width, ctx.canvas.height];
    const c = canvas.getContext('2d')!;
    c.setTransform(m);
    c.lineWidth = 0.6;
    c.imageSmoothingQuality = 'high';
    this.drawFaces(c, scene);
    for (const band of scene.bands) this.drawProps(c, band.props);
    this.layer = { canvas, bands: scene.bands, tiles: scene.tiles, key };
    performance.measure('props layer', { start, end: performance.now() });
    return canvas;
  }

  private drawFaces(ctx: CanvasRenderingContext2D, scene: Scene): void {
    for (const tile of scene.tiles) for (const face of tile.faces) this.drawFace(ctx, scene.hexSize, face, FACE_SHADE[face.side]);
  }

  /** A band's props: their shadows first, in one go (far cheaper than one by one), then what casts them. */
  private drawProps(ctx: CanvasRenderingContext2D, props: readonly PropInstance[]): void {
    drawShadows(ctx, props.flatMap((p) => this.shadowOf(p)));
    for (const p of props) this.drawProp(ctx, p);
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

  /** One prop: its sprite with a contact shadow, or its painted surface (a high lake) and what stands on it. */
  private drawProp(ctx: CanvasRenderingContext2D, p: PropInstance): void {
    if (p.surface) {
      const { raster, x, y, height } = p.surface;
      ctx.drawImage(this.canvasOf(raster), x, y, raster.width, height);
      drawShadows(ctx, (p.riders ?? []).flatMap((r) => this.shadowOf(r)));
      for (const r of p.riders ?? []) this.drawProp(ctx, r);
      return;
    }
    const { s, k } = this.sized(p);
    ctx.drawImage(s.image, p.x - (s.width * k) / 2, p.y - s.height * k, s.width * k, s.height * k);
  }

  /** The contact shadow under a prop, if its sprite wants one. */
  private shadowOf(p: PropInstance): { foot: Pixel; radius: number }[] {
    if (p.surface) return [];
    const { s, k } = this.sized(p);
    return s.shadow ? [{ foot: p, radius: s.shadow * k }] : [];
  }

  private canvasOf(r: Raster): HTMLCanvasElement {
    let canvas = this.canvases.get(r);
    if (!canvas) this.canvases.set(r, (canvas = rasterCanvas(r)));
    return canvas;
  }

  /** The prop's sprite variant and its scale (1 unless the prop asks for a height). */
  private sized(p: PropInstance): { s: Sprite; k: number } {
    const variants = this.sprites[p.kind];
    const s = variants[p.variant % variants.length];
    return { s, k: p.height ? p.height / s.height : 1 };
  }

  private outline(ctx: CanvasRenderingContext2D, points: Pixel[]): void {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    tracePolygon(ctx, points);
    ctx.stroke();
  }
}
