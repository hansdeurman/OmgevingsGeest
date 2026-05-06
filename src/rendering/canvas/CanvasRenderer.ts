import type { Renderer, RenderFrame } from '../Renderer';
import { offsetToPixel, hexCorners, gridPixelBounds } from '../../math/hex';
import { heightToRGB, shade, rgbToCss } from '../palette';
import { config, HEX_PIXEL_SIZE } from '../../config/parameters';
import {
  drawAirflowOverlay,
  drawWindSources,
  drawSourcePreview,
  drawDensityOverlay,
} from './airflowOverlay';

/**
 * 2D canvas renderer. Owns the canvas element. Resolution-aware: tracks DPR
 * and resets the device transform on resize so 1 logical pixel == 1 CSS px.
 */
export class CanvasRenderer implements Renderer {
  private host: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private dpr = 1;

  attach(host: HTMLElement): void {
    this.host = host;
    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    host.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  detach(): void {
    if (this.canvas && this.host) this.host.removeChild(this.canvas);
    this.canvas = null;
    this.ctx = null;
    this.host = null;
  }

  resize(width: number, height: number): void {
    if (!this.canvas || !this.ctx) return;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(width * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(height * this.dpr));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  render(frame: RenderFrame): void {
    const ctx = this.ctx;
    const canvas = this.canvas;
    if (!ctx || !canvas) return;

    const { world, camera, windField, windSources, densityReference, sourcePreview } = frame;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    ctx.fillStyle = '#0a0a10';
    ctx.fillRect(0, 0, w, h);

    const size = HEX_PIXEL_SIZE;
    const bounds = gridPixelBounds(world.width, world.height, size);

    ctx.save();
    ctx.translate(w / 2 + camera.x, h / 2 + camera.y);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-bounds.x / 2, -bounds.y / 2);

    const showGrid = config.showGrid;
    const shadeStrength = config.shadeStrength;

    // Height labels: density-throttle when hexes are tiny on screen so the
    // text is always legible. With small hex sizes we can't fit a label per
    // tile, so we render only every Nth tile in each axis (`stride`) and
    // size the font for that effective spacing.
    const labelOnScreen = size * camera.zoom;
    const showHeights = config.showHeights;
    let stride = 1;
    if (showHeights) {
      // Aim for at least ~22 px between labels on screen.
      stride = Math.max(1, Math.ceil(22 / Math.max(1, labelOnScreen)));
      const screenFont = Math.max(10, Math.min(13, labelOnScreen * stride * 0.45));
      const fontPx = screenFont / camera.zoom;
      ctx.font = `${fontPx}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 2 / camera.zoom;
    }

    for (const tile of world.tiles) {
      const { x, y } = offsetToPixel(tile.col, tile.row, size);
      // Frustum cull in world space (cheap rejection for large grids).
      const margin = size * 1.5;
      const sx = (x - bounds.x / 2) * camera.zoom + w / 2 + camera.x;
      const sy = (y - bounds.y / 2) * camera.zoom + h / 2 + camera.y;
      if (sx < -margin || sy < -margin || sx > w + margin || sy > h + margin) continue;

      // Shading: scale colour by 1 ± shadeStrength based on height. Cheap
      // pseudo-relief without a real lighting model.
      const k = 1 - shadeStrength * 0.5 + tile.height * shadeStrength;
      const rgb = shade(heightToRGB(tile.height), k);

      const corners = hexCorners(x, y, size);
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();

      ctx.fillStyle = rgbToCss(rgb);
      ctx.fill();

      if (showGrid) {
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      if (showHeights && tile.col % stride === 0 && tile.row % stride === 0) {
        const label = tile.height.toFixed(2);
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.strokeText(label, x, y);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, x, y);
      }
    }

    // Density backdrop sits between terrain and the velocity arrows so a
    // travelling parcel reads as a soft "cloud" with arrows on top.
    if (windField && config.showAirFlow && densityReference !== undefined) {
      drawDensityOverlay(ctx, world, windField, size, densityReference);
    }

    if (windField && config.showAirFlow) {
      drawAirflowOverlay(ctx, world, windField, {
        hexSize: size,
        stride: config.arrowStride,
        arrowScale: config.arrowScale,
        maxSpeed: config.windMaxSpeed,
        zoom: camera.zoom,
      });
    }

    if (windSources && windSources.length) {
      drawWindSources(ctx, windSources, size, camera.zoom, config.windMaxSpeed);
    }

    if (sourcePreview) {
      drawSourcePreview(ctx, sourcePreview.start, sourcePreview.end, size, camera.zoom);
    }

    ctx.restore();
  }
}
