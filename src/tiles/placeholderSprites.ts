import { rgbToCss, shade, type RGB } from '../rendering/palette';
import type { PropKind } from './propRules';

/** An upright image drawn with its bottom-centre on the prop's foot. Sizes in scene pixels. */
export interface Sprite {
  image: CanvasImageSource;
  width: number;
  height: number;
  /** Radius of a contact shadow the renderer draws under the foot; omit if the art has its own. */
  shadow?: number;
}

/** Sprite variants per prop kind. Real art can replace this record one kind at a time. */
export type SpriteSet = Record<PropKind, Sprite[]>;

type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

function sprite(width: number, height: number, res: number, paint: Painter): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * res);
  canvas.height = Math.ceil(height * res);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(res, res);
  paint(ctx, width, height);
  return { image: canvas, width, height };
}

/** Lit sphere-ish blob: light from the top-left, darker rim. */
function blob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, base: RGB): void {
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.45, r * 0.1, x, y, r);
  g.addColorStop(0, rgbToCss(shade(base, 1.3)));
  g.addColorStop(0.55, rgbToCss(base));
  g.addColorStop(1, rgbToCss(shade(base, 0.72)));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function footShadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number): void {
  ctx.fillStyle = 'rgba(30, 40, 20, 0.22)';
  ctx.beginPath();
  ctx.ellipse(x + rx * 0.15, y, rx, rx * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
}

function trunk(ctx: CanvasRenderingContext2D, x: number, bottom: number, w: number, h: number): void {
  ctx.fillStyle = '#7a4a26';
  ctx.fillRect(x - w / 2, bottom - h, w, h);
}

/**
 * Procedural stand-ins for the real sprite art, sized relative to the hex
 * radius `s`. `res` is the backing resolution so sprites stay crisp when the
 * view zooms in.
 */
export function createPlaceholderSprites(s: number, res = 3): SpriteSet {
  const roundTree = (base: RGB, k: number): Sprite =>
    sprite(0.64 * s * k, 0.95 * s * k, res, (ctx, w, h) => {
      const cx = w / 2;
      const u = s * k;
      footShadow(ctx, cx, h - 0.06 * u, 0.24 * u);
      trunk(ctx, cx, h - 0.05 * u, 0.08 * u, 0.3 * u);
      blob(ctx, cx - 0.12 * u, h - 0.42 * u, 0.17 * u, shade(base, 0.9));
      blob(ctx, cx + 0.12 * u, h - 0.44 * u, 0.17 * u, shade(base, 0.85));
      blob(ctx, cx, h - 0.62 * u, 0.22 * u, base);
    });

  const pine = (base: RGB, k: number): Sprite =>
    sprite(0.5 * s * k, 1.1 * s * k, res, (ctx, w, h) => {
      const cx = w / 2;
      const u = s * k;
      footShadow(ctx, cx, h - 0.06 * u, 0.2 * u);
      trunk(ctx, cx, h - 0.05 * u, 0.07 * u, 0.22 * u);
      [[0.22, 0.48, 0.23], [0.42, 0.7, 0.18], [0.62, 0.95, 0.13]].forEach(([y0, y1, half]) => {
        const g = ctx.createLinearGradient(cx - half * u, 0, cx + half * u, 0);
        g.addColorStop(0, rgbToCss(shade(base, 1.25)));
        g.addColorStop(1, rgbToCss(shade(base, 0.75)));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(cx - half * u, h - y0 * u);
        ctx.lineTo(cx + half * u, h - y0 * u);
        ctx.lineTo(cx, h - y1 * u);
        ctx.closePath();
        ctx.fill();
      });
    });

  const bush = (base: RGB): Sprite =>
    sprite(0.4 * s, 0.3 * s, res, (ctx, w, h) => {
      footShadow(ctx, w / 2, h - 0.04 * s, 0.17 * s);
      blob(ctx, w / 2 - 0.08 * s, h - 0.1 * s, 0.09 * s, shade(base, 0.9));
      blob(ctx, w / 2 + 0.08 * s, h - 0.1 * s, 0.09 * s, shade(base, 0.85));
      blob(ctx, w / 2, h - 0.16 * s, 0.11 * s, base);
    });

  const tuft = (base: RGB): Sprite =>
    sprite(0.22 * s, 0.2 * s, res, (ctx, w, h) => {
      ctx.strokeStyle = rgbToCss(base);
      ctx.lineWidth = 0.028 * s;
      ctx.lineCap = 'round';
      for (const lean of [-0.8, -0.4, 0, 0.4, 0.8]) {
        ctx.beginPath();
        ctx.moveTo(w / 2 + lean * 0.02 * s, h - 0.01 * s);
        ctx.quadraticCurveTo(w / 2 + lean * 0.04 * s, h - 0.1 * s, w / 2 + lean * 0.1 * s, h - (0.18 - Math.abs(lean) * 0.05) * s);
        ctx.stroke();
      }
    });

  const flower = (petal: RGB): Sprite =>
    sprite(0.12 * s, 0.14 * s, res, (ctx, w, h) => {
      ctx.strokeStyle = '#4d9a35';
      ctx.lineWidth = 0.02 * s;
      ctx.beginPath();
      ctx.moveTo(w / 2, h);
      ctx.lineTo(w / 2, h - 0.08 * s);
      ctx.stroke();
      ctx.fillStyle = rgbToCss(petal);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(w / 2 + Math.cos(a) * 0.025 * s, h - 0.09 * s + Math.sin(a) * 0.02 * s, 0.022 * s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.arc(w / 2, h - 0.09 * s, 0.015 * s, 0, Math.PI * 2);
      ctx.fill();
    });

  const reed = (lean: number): Sprite =>
    sprite(0.2 * s, 0.38 * s, res, (ctx, w, h) => {
      ctx.lineCap = 'round';
      [-0.05, -0.015, 0.02, 0.05].forEach((dx, i) => {
        const top = h - (0.24 + (i % 2) * 0.08) * s;
        ctx.strokeStyle = '#6f9a3a';
        ctx.lineWidth = 0.018 * s;
        ctx.beginPath();
        ctx.moveTo(w / 2 + dx * s, h);
        ctx.quadraticCurveTo(w / 2 + dx * s, h - 0.12 * s, w / 2 + (dx + lean) * s, top);
        ctx.stroke();
        ctx.fillStyle = '#7a4a26';
        ctx.beginPath();
        ctx.ellipse(w / 2 + (dx + lean) * s, top + 0.03 * s, 0.014 * s, 0.035 * s, 0, 0, Math.PI * 2);
        ctx.fill();
      });
    });

  const pebble = (base: RGB): Sprite =>
    sprite(0.16 * s, 0.09 * s, res, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, rgbToCss(shade(base, 1.2)));
      g.addColorStop(1, rgbToCss(shade(base, 0.75)));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w / 2 - 0.01 * s, h / 2 - 0.005 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    });

  const mountain = (w: number, h: number, base: RGB, cap: number): Sprite =>
    sprite(w * s, h * s, res, (ctx, cw, ch) => {
      const g = ctx.createLinearGradient(0, 0, cw, 0);
      g.addColorStop(0, rgbToCss(shade(base, 1.2)));
      g.addColorStop(1, rgbToCss(shade(base, 0.7)));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, ch);
      ctx.lineTo(cw / 2, 0);
      ctx.lineTo(cw, ch);
      ctx.closePath();
      ctx.fill();
      if (cap <= 0) return;
      ctx.fillStyle = '#f4f8fc';
      ctx.beginPath();
      ctx.moveTo(cw / 2, 0);
      ctx.lineTo(cw / 2 - (cw / 2) * cap, ch * cap);
      ctx.lineTo(cw / 2 + (cw / 2) * cap, ch * cap);
      ctx.closePath();
      ctx.fill();
    });

  const mound = (w: number, h: number, base: RGB): Sprite =>
    sprite(w * s, h * s, res, (ctx, cw, ch) => {
      blob(ctx, cw * 0.32, ch * 0.62, ch * 0.38, shade(base, 0.9));
      blob(ctx, cw * 0.68, ch * 0.64, ch * 0.36, shade(base, 0.8));
      blob(ctx, cw * 0.5, ch * 0.5, ch * 0.48, base);
    });

  return {
    peak: [mountain(1.6, 1.5, [140, 128, 116], 0.35), mountain(1.4, 1.3, [128, 120, 110], 0.25)],
    crag: [mountain(1.3, 1.2, [150, 138, 124], 0)],
    hill: [mound(1.2, 0.6, [150, 160, 110])],
    boulder: [mound(0.6, 0.42, [160, 152, 140])],
    tree: [
      roundTree([86, 178, 72], 1),
      roundTree([72, 160, 64], 0.9),
      roundTree([110, 190, 76], 1.05),
      pine([46, 138, 74], 1),
      pine([40, 124, 70], 0.85),
    ],
    bush: [bush([92, 170, 66]), bush([78, 150, 60])],
    tuft: [tuft([96, 168, 60]), tuft([124, 180, 70]), tuft([150, 176, 74])],
    flower: [flower([255, 255, 255]), flower([255, 210, 60]), flower([244, 120, 150]), flower([236, 84, 72])],
    reed: [reed(-0.02), reed(0.02)],
    pebble: [pebble([186, 180, 170]), pebble([160, 154, 146])],
  };
}
