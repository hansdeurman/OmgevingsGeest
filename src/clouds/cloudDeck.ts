import { pixelToOffset } from '../math/hex';
import { mulberry32 } from '../math/rng';
import { smoothstep } from '../math/scalar';
import { frameCentre, type GridFrame } from '../tiles/geometry';

/**
 * The clouds as the player sees them: puffs that drift with the wind and
 * grow, darken and fade with the cloud the air holds under them, so the
 * sky moves smoothly between the model's steps and a cloud keeps its shape
 * as it goes. New puffs gather where cloud forms that no puff covers yet.
 * Positions on the flat map, in frame px.
 */
export interface Puff {
  x: number;
  y: number;
  /** Width now, and the width it grows or shrinks toward. */
  size: number;
  target: number;
  /** How much of it shows (0–1): it fades in as it forms and out as it dissolves. */
  shown: number;
  /** 0 white … 1 dark with rain. */
  dark: number;
  /** How hard it rains or snows from it (0–1), and whether it snows. */
  fall: number;
  snow: boolean;
  /** Which of the cloud shapes it has, and a number of its own. */
  shape: number;
  seed: number;
}

/** The sky the puffs follow, per hex: cloud, what falls (steps), the wind (hex spacings per step), and whether what falls is snow. */
export interface SkyField {
  cloud: ArrayLike<number>;
  fall: ArrayLike<number>;
  wind: { x: number; y: number };
  snow?: (i: number) => boolean;
}

export interface DeckMap {
  /** The hex at a frame pixel, -1 off the map. */
  hexAt(x: number, y: number): number;
  centre(i: number): { x: number; y: number };
  n: number;
  /** Frame px between neighbouring hexes' centres. */
  spacing: number;
}

export interface CloudDeck {
  readonly puffs: readonly Puff[];
  /** Move on `steps` model steps (fractions too) under `sky`. */
  update(sky: SkyField, steps: number): void;
  /** The puffs of `sky` at once, full grown: after a jump in time. */
  reset(sky: SkyField): void;
}

/** Cloud (steps) a puff needs at the least, and at which it is as big as puffs get. */
const CLOUD = { from: 0.015, full: 0.12 };
/** What falls (steps per step) for a puff to rain at all, and to rain hard. */
const FALL = { from: 0.001, full: 0.015 };
/** Puff width at the least cloud and at full cloud, in hex spacings. */
const WIDTH = { least: 1.6, most: 4.2 };
/** Share of the way to its target a puff goes per step as it forms or changes, and faster as it dissolves. */
const EASE = 0.08;
const DISSOLVE = 0.2;
/** A puff covers ground this share of its width from its middle: no new puff is made there. */
const COVERS = 0.5;
/** New puffs per step at most, so cloud forming shows as puffs growing in, not popping up all at once. */
const NEW_PER_STEP = 6;
/** A dissolving puff showing less than this is gone. */
const GONE = 0.02;
/** A new puff starts at this share of its width, growing as it fades in. */
const BUD = 0.5;
/** Placeholder art has this many cloud shapes. */
export const SHAPES = 4;

const widthOf = (cloud: number, spacing: number) =>
  cloud < CLOUD.from ? 0 : spacing * (WIDTH.least + (WIDTH.most - WIDTH.least) * smoothstep(CLOUD.from, CLOUD.full, cloud));

export function deckMap(cols: number, rows: number, size: number, frame: GridFrame): DeckMap {
  return {
    n: cols * rows,
    spacing: size * Math.sqrt(3),
    centre: (i) => frameCentre(i % cols, Math.floor(i / cols), size, frame),
    hexAt(x, y) {
      const { col, row } = pixelToOffset(x - frame.ox, y - frame.oy, size);
      return col < 0 || row < 0 || col >= cols || row >= rows ? -1 : row * cols + col;
    },
  };
}

export function createDeck(map: DeckMap, seed: number): CloudDeck {
  let puffs: Puff[] = [];
  const random = mulberry32(seed * 7919 + 17);
  const covered = new Uint8Array(map.n);

  /** Mark the hexes a puff of width `w` at (x, y) covers. */
  const cover = (x: number, y: number, w: number) => {
    const r = Math.max(w * COVERS, map.spacing * 0.5);
    const step = map.spacing / 2;
    for (let dy = -r; dy <= r; dy += step)
      for (let dx = -r; dx <= r; dx += step) {
        if (dx * dx + dy * dy > r * r) continue;
        const i = map.hexAt(x + dx, y + dy);
        if (i >= 0) covered[i] = 1;
      }
  };

  /** Set a puff's targets from the sky under it (none if `crowded`); `steps` on towards them. */
  const follow = (p: Puff, sky: SkyField, steps: number, crowded = false) => {
    const i = map.hexAt(p.x, p.y);
    const [cloud, fall] = i < 0 ? [0, 0] : [sky.cloud[i], sky.fall[i]];
    p.target = crowded ? 0 : widthOf(cloud, map.spacing);
    const k = 1 - (1 - (p.target ? EASE : DISSOLVE)) ** steps;
    const rain = cloud < CLOUD.from ? 0 : smoothstep(FALL.from, FALL.full, fall);
    p.size += (p.target - p.size) * k;
    p.shown += ((p.target ? 1 : 0) - p.shown) * k;
    p.dark += (rain - p.dark) * k;
    p.fall += (rain - p.fall) * k;
    p.snow = i >= 0 && !!sky.snow?.(i);
  };

  /** New puffs where cloud is that no puff covers (`covered`), thickest first; `grown`: at full size at once. */
  const gather = (sky: SkyField, most: number, grown: boolean) => {
    const open = Array.from({ length: map.n }, (_, i) => i).filter((i) => !covered[i] && sky.cloud[i] >= CLOUD.from);
    open.sort((a, b) => sky.cloud[b] - sky.cloud[a]);
    for (const i of open) {
      if (most <= 0) break;
      if (covered[i]) continue;
      const c = map.centre(i);
      const p: Puff = {
        x: c.x + (random() - 0.5) * 0.6 * map.spacing,
        y: c.y + (random() - 0.5) * 0.6 * map.spacing,
        size: 0,
        target: 0,
        shown: 0,
        dark: 0,
        fall: 0,
        snow: false,
        shape: Math.floor(random() * SHAPES),
        seed: Math.floor(random() * 1e6),
      };
      follow(p, sky, grown ? Infinity : 0);
      if (!p.target) continue;
      if (!grown) p.size = BUD * p.target;
      puffs.push(p);
      cover(p.x, p.y, p.target);
      most--;
    }
  };

  return {
    get puffs() {
      return puffs;
    },
    update(sky, steps) {
      if (steps <= 0) return;
      const [dx, dy] = [sky.wind.x * map.spacing * steps, sky.wind.y * map.spacing * steps];
      covered.fill(0);
      for (const p of puffs) {
        p.x += dx;
        p.y += dy;
        // Where an older puff covers a younger one, the younger fades: puffs never heap up.
        const i = map.hexAt(p.x, p.y);
        const crowded = i >= 0 && covered[i] === 1;
        follow(p, sky, steps, crowded);
        if (!crowded && p.target) cover(p.x, p.y, Math.max(p.size, p.target));
      }
      puffs = puffs.filter((p) => p.target > 0 || p.shown > GONE);
      gather(sky, Math.ceil(NEW_PER_STEP * steps), false);
    },
    reset(sky) {
      puffs = [];
      covered.fill(0);
      gather(sky, Infinity, true);
    },
  };
}
