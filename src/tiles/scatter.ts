import { offsetToPixel, pixelToOffset, type Pixel } from '../math/hex';
import { hash2 } from '../math/noise';
import { mulberry32 } from '../math/rng';
import { forEachCell, type CoverGrid } from './coverGrid';
import type { CoverField } from './coverField';
import type { PropKind, PropRule } from './propRules';

/** A placed prop, in grid-local top-down pixels. `variant` is any uint; renderers wrap it. */
export interface PropInstance {
  kind: PropKind;
  variant: number;
  x: number;
  y: number;
  /** The hex it stands on. */
  col: number;
  row: number;
}

const CANDIDATES = 40;
/** Random share of a candidate's score; the rest is how dense the preferred layer is. */
const JITTER = 0.25;
/** Keep prop feet slightly inside the hex so they don't straddle the edge. */
const INSET = 0.85;
/** How far a centred prop may drift from the hex centre, in hex radii. */
const CENTRE_JITTER = 0.15;

/** Deterministic seed per (hex, rule, map seed). */
const cellSeed = (col: number, row: number, salt: number) => Math.floor(hash2(col, row, salt) * 0xffffffff);

function candidates(col: number, row: number, size: number, rng: () => number, centred = false): Pixel[] {
  const c = offsetToPixel(col, row, size);
  if (centred) {
    const a = rng() * Math.PI * 2;
    const r = rng() * CENTRE_JITTER * size;
    return [{ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }];
  }
  const hw = (Math.sqrt(3) / 2) * size * INSET;
  const hh = size * INSET;
  const out: Pixel[] = [];
  for (let tries = 0; out.length < CANDIDATES && tries < CANDIDATES * 3; tries++) {
    const p = { x: c.x + (rng() * 2 - 1) * hw, y: c.y + (rng() * 2 - 1) * hh };
    const h = pixelToOffset(p.x, p.y, size);
    if (h.col === col && h.row === row) out.push(p);
  }
  return out;
}

/** Best-scoring fitting spots, greedily kept apart by the rule's spacing. */
function pickSpots(spots: Pixel[], n: number, rule: PropRule, field: CoverField, size: number, rng: () => number): Pixel[] {
  const minDist = rule.spacing * size;
  const scored = spots
    .map((p) => ({ p, a: field.sample(p.x, p.y), r: rng() }))
    .filter((s) => rule.fits(s.a))
    .map((s) => ({ p: s.p, score: (rule.prefer ? s.a[rule.prefer] : 0) + s.r * JITTER }))
    .sort((a, b) => b.score - a.score);
  const chosen: Pixel[] = [];
  for (const { p } of scored) {
    if (chosen.length >= n) break;
    if (chosen.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= minDist)) chosen.push(p);
  }
  return chosen;
}

/** Scatter props over every hex according to the rules. Pure and seeded. */
export function scatterProps(
  grid: CoverGrid,
  field: CoverField,
  rules: readonly PropRule[],
  size: number,
  seed: number,
): PropInstance[] {
  const out: PropInstance[] = [];
  forEachCell(grid, (cover, col, row, elevation) => {
    rules.forEach((rule, i) => {
      const n = rule.count(cover, elevation);
      if (n <= 0) return;
      const rng = mulberry32(cellSeed(col, row, seed * 31 + i));
      if (rng() >= (rule.chance ?? 1)) return;
      for (const p of pickSpots(candidates(col, row, size, rng, rule.centred), n, rule, field, size, rng)) {
        out.push({ kind: rule.kind, variant: Math.floor(rng() * 0xffff), x: p.x, y: p.y, col, row });
      }
    });
  });
  return out;
}
