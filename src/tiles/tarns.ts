import { offsetNeighbours, offsetToPixel, type Pixel } from '../math/hex';
import { hash2, valueNoise2D } from '../math/noise';
import { clamp, smoothstep } from '../math/scalar';
import type { CoverGrid } from './coverGrid';
import { MAX_ELEVATION } from './levels';
import { blurHeights } from './relief';
import type { PropKind } from './propRules';
import type { River } from './rivers';
import type { PropInstance } from './scatter';

/**
 * Mountain lakes: a high lake is drawn as table mountains holding water,
 * never as water on the ground. Every high lake cell gets one, and so does
 * every edge between two of them, so the rock of a lake of any size and
 * shape reads as one massif. One water surface, lifted to the rims, then
 * covers the hollows of all pieces: it follows the pieces' own oval at the
 * lake's edge, so the stone rim stays visible all around, and hides the
 * rims inside the lake. A lone shallow cell is a pond. The cell where the
 * lake spills gets a waterfall toward its outlet.
 */

/** Elevation (steps) from which standing water is a mountain lake. */
export const TARN_FROM = 2.5;

/**
 * How tall a lake's rim stands, as a share of a full mountain-lake piece:
 * low on the foothills, full height high in the range. Pieces are only
 * stretched vertically, so the hollow keeps its width.
 */
export function rimScale(level: number): number {
  return clamp(0.4 + (0.6 * (level - TARN_FROM)) / (MAX_ELEVATION - 1 - TARN_FROM), 0.4, 1);
}
/** In-game height of a mountain-lake piece, in hex radii. */
export const TARN_HEIGHT = 0.8;
/**
 * The pieces' shape, measured from the art: width per height, and the water
 * oval's centre (share of the height from the top) and half axes (shares of
 * the width and the height).
 */
export const TARN_SHAPE = { aspect: 1.87, top: 0.28, rx: 0.29, ry: 0.155 } as const;

/** A mountain lake: its pieces back to front, and its shared water surface (grid-local ground pixels). */
export interface TarnGroup {
  parts: PropInstance[];
  surface?: Surface;
}

/** Coverage (0..1) of a lake's water surface over a box of ground pixels, and how far it is lifted on screen. */
export interface Surface {
  alpha: Float32Array;
  /** Distance from the shore (ground pixels, across the oval), 0 outside: for depth shading. */
  inset: Float32Array;
  x0: number;
  y0: number;
  width: number;
  height: number;
  lift: number;
  /** The lake's surface elevation (steps): higher water is colder and darker. */
  level: number;
}

const FULL: ReadonlySet<PropKind> = new Set(['tarn', 'tarnFront', 'tarnSide']);
/** How much the inner corners of a lake's shore are filled in, as a share of the oval's half width. */
const CORNER_ROUNDING = 0.5;
/** How far a lake's shore waves inward, as a share of the oval's half width. */
const SHORE_WAVE = 0.8;

/** The waterfall sprite facing from `a` toward `b`: toward the viewer, sideways, or none when it pours away behind. */
function spillKind(a: Pixel, b: Pixel): { kind: PropKind; flip: boolean } | undefined {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const d = Math.hypot(dx, dy);
  if (dy > 0.35 * d) return { kind: 'tarnFront', flip: dx < 0 };
  if (dy > -0.6 * d) return { kind: 'tarnSide', flip: dx < 0 };
  return undefined;
}

/** Distance from p to the segment a-b. */
function segmentDistance(p: Pixel, a: Pixel, b: Pixel): number {
  const [vx, vy] = [b.x - a.x, b.y - a.y];
  const t = clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy || 1), 0, 1);
  return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy);
}

function inTriangle(p: Pixel, a: Pixel, b: Pixel, c: Pixel): boolean {
  const side = (u: Pixel, v: Pixel) => (v.x - u.x) * (p.y - u.y) - (v.y - u.y) * (p.x - u.x);
  const [s1, s2, s3] = [side(a, b), side(b, c), side(c, a)];
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}

/**
 * The water surface over lake pieces at `centres`: each piece's oval (half
 * axes `rx`, `ry`), swept along every link between two pieces and filled
 * between every three linked pieces, its inner corners filled in. Anti-aliased
 * at its edge; `wave` pulls the shore inward by up to `amount` of rx, so long
 * shores are not straight (never outward, so the stone rim always shows).
 */
export function lakeSurface(
  centres: readonly Pixel[],
  links: readonly [number, number][],
  rx: number,
  ry: number,
  wave = { amount: 0, seed: 0 },
): Omit<Surface, 'lift' | 'level'> {
  // In a space squeezed so the oval becomes a circle of radius rx, the surface is everything within rx of the skeleton.
  const k = rx / ry;
  const pts = centres.map((c) => ({ x: c.x, y: c.y * k }));
  const linked = new Set(links.map(([a, b]) => `${Math.min(a, b)},${Math.max(a, b)}`));
  const isLinked = (a: number, b: number) => linked.has(`${Math.min(a, b)},${Math.max(a, b)}`);
  const triangles = links.flatMap(([a, b]) => pts.map((_, c) => c).filter((c) => c > a && c > b && isLinked(a, c) && isLinked(b, c)).map((c) => [a, b, c]));
  const distance = (p: Pixel) => {
    if (triangles.some(([a, b, c]) => inTriangle(p, pts[a], pts[b], pts[c]))) return 0;
    const near = Math.min(...pts.map((c) => Math.hypot(p.x - c.x, p.y - c.y)));
    return Math.min(near, ...links.map(([a, b]) => segmentDistance(p, pts[a], pts[b])));
  };

  const x0 = Math.floor(Math.min(...centres.map((c) => c.x)) - rx - 1);
  const y0 = Math.floor(Math.min(...centres.map((c) => c.y)) - ry - 1);
  const width = Math.ceil(Math.max(...centres.map((c) => c.x)) + rx + 1) - x0;
  const height = Math.ceil(Math.max(...centres.map((c) => c.y)) + ry + 1) - y0;
  // Signed depth below the shore line per pixel.
  const depth = new Float32Array(width * height);
  const waveScale = 1 / (1.6 * rx);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [gx, gy] = [x0 + x + 0.5, y0 + y + 0.5];
      const shift = wave.amount ? rx * wave.amount * smoothstep(0.3, 0.7, valueNoise2D(gx * waveScale, gy * waveScale, wave.seed)) : 0;
      depth[y * width + x] = rx - distance({ x: gx, y: gy * k }) - shift;
    }
  }
  // Smoothing fills the sharp inner corners where pieces join; keeping the larger depth leaves the outer edge as it is.
  const smooth = depth.slice();
  blurHeights(smooth, width, height, Math.max(1, Math.round(rx * CORNER_ROUNDING)));
  const filled = depth.map((d, i) => Math.max(d, smooth[i]));
  const alpha = filled.map((d) => clamp(d + 0.5, 0, 1));
  const inset = filled.map((d) => Math.max(0, d));
  return { alpha, inset, x0, y0, width, height };
}

/** Each mountain lake's pieces and water surface, in grid-local ground pixels. `squash` is the view's vertical squash. */
export function tarnGroups(grid: CoverGrid, size: number, seed: number, rivers: readonly River[], squash: number): TarnGroup[] {
  const { cols, rows } = grid;
  const at = (c: number, r: number) => (c < 0 || r < 0 || c >= cols || r >= rows ? -1 : r * cols + c);
  const isTarn = (i: number) => i >= 0 && grid.elevation[i] >= TARN_FROM && grid.cells[i].water >= 2;
  const neighbours = (i: number) => offsetNeighbours(Math.floor(i / cols)).map((d) => at((i % cols) + d.dc, Math.floor(i / cols) + d.dr)).filter(isTarn);
  const centre = (i: number) => offsetToPixel(i % cols, Math.floor(i / cols), size);
  const spills = new Map(rivers.map((r) => [r.cells[0], spillKind(centre(r.cells[0]), centre(r.outlet[1]))]));
  const piece = (kind: PropKind, p: Pixel, a: number, b: number, flip = false): PropInstance => ({
    kind,
    heightScale: rimScale(grid.elevation[a]),
    variant: Math.floor(hash2(a, b, seed + 5) * 1000),
    x: p.x,
    y: p.y,
    col: a % cols,
    row: Math.floor(a / cols),
    flip,
  });
  const ownPiece = (i: number) => {
    const spill = spills.get(i);
    if (spill) return piece(spill.kind, centre(i), i, i, spill.flip);
    const full = grid.cells[i].water >= 3 || neighbours(i).length > 0;
    return piece(full ? 'tarn' : 'tarnLow', centre(i), i, i);
  };

  const h = TARN_HEIGHT * size;
  const rx = TARN_SHAPE.rx * TARN_SHAPE.aspect * h;
  const seen = new Set<number>();
  const groups: TarnGroup[] = [];
  for (let start = 0; start < cols * rows; start++) {
    if (seen.has(start) || !isTarn(start)) continue;
    const cells = [start];
    seen.add(start);
    for (let q = 0; q < cells.length; q++) {
      for (const j of neighbours(cells[q])) {
        if (seen.has(j)) continue;
        seen.add(j);
        cells.push(j);
      }
    }
    const own = cells.map(ownPiece);
    const links = cells.flatMap((i, a) =>
      neighbours(i)
        .filter((j) => j > i) // each edge once
        .map((j) => [a, cells.indexOf(j)] as [number, number]),
    );
    const linkPieces = links.map(([a, b]) => {
      const [p, q] = [centre(cells[a]), centre(cells[b])];
      return piece('tarn', { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, cells[a], cells[b]);
    });
    const full = own.map((p) => FULL.has(p.kind));
    const level = grid.elevation[start];
    const tall = h * rimScale(level);
    const ry = (TARN_SHAPE.ry * tall) / squash; // the oval's depth on the ground, before the view squashes it
    const fullLinks = links.filter(([a, b]) => full[a] && full[b]);
    const surface = full.some(Boolean)
      ? { ...lakeSurface(cells.map(centre), fullLinks, rx, ry, { amount: SHORE_WAVE, seed }), lift: (1 - TARN_SHAPE.top) * tall, level }
      : undefined;
    groups.push({ parts: [...own, ...linkPieces].sort((a, b) => a.y - b.y), surface });
  }
  return groups;
}
