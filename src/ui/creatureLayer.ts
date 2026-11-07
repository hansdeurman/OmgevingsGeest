import { BESTIARY } from '../life/bestiary';
import type { CreatureView } from '../life/ecosystem';
import { GIFTS, powersOf, type Avatar } from '../player/avatar';
import { ELEMENT_LOOK } from '../life/elements';
import { paintAvatar } from './avatarArt';
import { paintCreature, paletteOf, type Paint } from './creatureArt';

/**
 * The creatures over the map: where each is drawn between two steps of the
 * run (they glide from one step's place to the next), how big, which way it
 * faces, how far through a wingbeat or stride, and lifted into the air if
 * it flies; then drawn, each from a small picture painted once per kind,
 * size, facing and pose.
 */
export interface Placed {
  id: number;
  kind: number;
  /** Where it is drawn (screen px), and the ground under it, for its shadow. */
  x: number;
  y: number;
  groundY: number;
  size: number;
  facing: 1 | -1;
  /** Which of the pose frames to draw. */
  frame: number;
  alpha: number;
  asleep: boolean;
  mystic: boolean;
}

/** How a view puts the map on screen: map position (hex spacings) → screen px, standing on the ground there; and screen px per hex spacing. */
export interface Projection {
  toScreen(x: number, y: number): { x: number; y: number };
  spacing: number;
}

/** Poses per wingbeat or stride; beats per second, flying and on foot; how high fliers fly and how big creatures are drawn (in hex spacings, per their size), at least so many px. */
export const FRAMES = 4;
const BEATS = { fly: 3, walk: 1.6 };
const ALTITUDE = 0.5;
const SCALE = 2;
const SMALLEST = 11;
/** Further than this (hex spacings) between two steps, it is not walking there: it is put there. */
const JUMP = 2;

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Where to draw each creature (not those away), `t` of the way from the step before (`prev`) to this one, at `time` (s); back to front. */
export function placeCreatures(prev: readonly CreatureView[] | undefined, cur: readonly CreatureView[], t: number, view: Projection, time: number): Placed[] {
  const before = new Map(prev?.map((c) => [c.id, c]));
  const placed: Placed[] = [];
  for (const c of cur) {
    if (c.doing === 'away') continue;
    const s = BESTIARY[c.kind];
    const was = before.get(c.id);
    const glides = was && was.doing !== 'away' && Math.hypot(was.x - c.x, was.y - c.y) < JUMP;
    const [x, y] = glides ? [mix(was.x, c.x, t), mix(was.y, c.y, t)] : [c.x, c.y];
    const ground = view.toScreen(x, y);
    const asleep = c.doing === 'sleep';
    const flying = s.moves === 'fly' && !asleep;
    const dx = glides ? c.x - was.x : 0;
    const beat = asleep ? 0 : (time * (flying ? BEATS.fly : BEATS.walk) + c.id * 0.37) % 1;
    placed.push({
      id: c.id,
      kind: c.kind,
      x: ground.x,
      y: ground.y - (flying ? (ALTITUDE + s.size / 2) * view.spacing : 0),
      groundY: ground.y,
      size: Math.max(SMALLEST, s.size * SCALE * view.spacing),
      facing: Math.abs(dx) > 0.01 ? (dx > 0 ? 1 : -1) : Math.cos(c.heading) >= 0 ? 1 : -1,
      frame: Math.floor(beat * FRAMES),
      alpha: was ? 1 : Math.min(1, t * 2),
      asleep,
      mystic: s.mystic,
    });
  }
  return placed.sort((a, b) => a.groundY - b.groundY);
}

/** The creature drawn nearest (x, y) on screen, if one is drawn there. */
export function creatureAt(placed: readonly Placed[], x: number, y: number): Placed | undefined {
  let [best, far] = [undefined as Placed | undefined, Infinity];
  for (const p of placed) {
    const d = Math.hypot(p.x - x, p.y - p.size * 0.2 - y);
    if (d < Math.max(12, p.size * 0.6) && d < far) [best, far] = [p, d];
  }
  return best;
}

/** Pictures of the creatures, painted once each per kind, size, facing, pose and sleep. */
export class CreatureSprites {
  private cache = new Map<string, HTMLCanvasElement>();

  constructor(private make: (w: number, h: number) => HTMLCanvasElement = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h })) {}

  /** A creature's picture, about `size` px long (the size it was painted at), and where on it its feet are. */
  get(p: Pick<Placed, 'kind' | 'size' | 'facing' | 'frame' | 'asleep'>): { image: HTMLCanvasElement; size: number; footX: number; footY: number } {
    const size = Math.max(4, Math.round(p.size / 2) * 2);
    const key = `${p.kind}:${size}:${p.facing}:${p.frame}:${p.asleep}`;
    const [w, h] = [Math.ceil(size * 1.5), Math.ceil(size * 1.05)];
    let image = this.cache.get(key);
    if (!image) {
      image = this.make(w, h);
      const ctx = image.getContext('2d')!;
      ctx.translate(w / 2, size * 0.66);
      paintCreature(ctx as unknown as Paint, BESTIARY[p.kind], size, { phase: (p.frame + 0.5) / FRAMES, facing: p.facing, asleep: p.asleep });
      this.cache.set(key, image);
    }
    return { image, size, footX: w / 2, footY: size * 0.96 };
  }
}

/** Draw the creatures: a shadow on the ground under each, a glow round the mystic ones, and the creature. */
export function drawCreatures(ctx: CanvasRenderingContext2D, placed: readonly Placed[], sprites: CreatureSprites, time: number): void {
  for (const p of placed) {
    ctx.globalAlpha = p.alpha * 0.28;
    ctx.fillStyle = '#0B1020';
    ctx.beginPath();
    ctx.ellipse(p.x, p.groundY, p.size * 0.32, p.size * 0.08, 0, 0, 2 * Math.PI);
    ctx.fill();
    if (p.mystic) glow(ctx, p, time);
    const { image, size, footX, footY } = sprites.get(p);
    const k = p.size / size;
    ctx.globalAlpha = p.alpha;
    ctx.drawImage(image, p.x - footX * k, p.y - footY * k, image.width * k, image.height * k);
  }
  ctx.globalAlpha = 1;
}

/** A soft pulsing light in the creature's colour round a mystic one. */
function glow(ctx: CanvasRenderingContext2D, p: Placed, time: number): void {
  const r = p.size * (0.75 + 0.08 * Math.sin(time * 2.5 + p.id));
  const [cx, cy] = [p.x, p.y - p.size * 0.15];
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  const colour = paletteOf(BESTIARY[p.kind]).main;
  g.addColorStop(0, colour + '88');
  g.addColorStop(1, colour + '00');
  ctx.globalAlpha = p.alpha;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, r, 0, 0, 2 * Math.PI);
  ctx.fill();
}

/** Where and how the avatar is drawn: like a creature, bigger, with the ring its gift reaches and where it is walking to. */
export interface PlacedAvatar {
  avatar: Avatar;
  x: number;
  y: number;
  size: number;
  facing: 1 | -1;
  phase: number;
  /** The ring its gift reaches on the ground (screen px), in the gift's colour; none at rest. */
  ring?: { rx: number; ry: number; colour: string };
  /** Where it is walking to, on screen. */
  target?: { x: number; y: number };
}

/** The avatar's size (hex spacings), and least size (px). */
const AVATAR = { size: 1.6, least: 32 };

/** Where to draw the avatar, `t` of the way from where it was (`prev`) to where it is now, at `time` (s). */
export function placeAvatar(prev: Avatar | undefined, cur: Avatar, t: number, view: Projection, time: number): PlacedAvatar {
  const glides = prev && Math.hypot(prev.x - cur.x, prev.y - cur.y) < JUMP;
  const [x, y] = glides ? [mix(prev.x, cur.x, t), mix(prev.y, cur.y, t)] : [cur.x, cur.y];
  const ground = view.toScreen(x, y);
  const walking = !!glides && Math.hypot(prev.x - cur.x, prev.y - cur.y) > 0.01;
  const reach = Math.max(-1, ...powersOf(cur).map((p) => p.reach));
  const edge = (dx: number, dy: number) => view.toScreen(x + dx, y + dy);
  return {
    avatar: cur,
    x: ground.x,
    y: ground.y,
    size: Math.max(AVATAR.least, AVATAR.size * view.spacing),
    facing: Math.cos(cur.heading) >= 0 ? 1 : -1,
    phase: walking ? (time * BEATS.walk) % 1 : 0,
    ring: cur.gift && reach >= 0 ? { rx: Math.abs(edge(reach + 0.5, 0).x - ground.x), ry: Math.abs(edge(0, reach + 0.5).y - ground.y), colour: ELEMENT_LOOK[GIFTS[cur.gift].element].colour } : undefined,
    target: cur.target && view.toScreen(cur.target.x, cur.target.y),
  };
}

/** Draw the avatar: the ring its gift reaches, a marker where it walks to, a glow, and the avatar itself. */
export function drawAvatar(ctx: CanvasRenderingContext2D, p: PlacedAvatar, time: number): void {
  const pulse = 0.5 + 0.5 * Math.sin(time * 3);
  if (p.ring) {
    ctx.globalAlpha = 0.18 + 0.1 * pulse;
    ctx.fillStyle = p.ring.colour;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.ring.rx, p.ring.ry, 0, 0, 2 * Math.PI);
    ctx.fill();
  }
  if (p.target) {
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#FFD23F';
    ctx.beginPath();
    ctx.ellipse(p.target.x, p.target.y, 6 + 2 * pulse, 3 + pulse, 0, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = '#0B1020';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, p.size * 0.3, p.size * 0.08, 0, 0, 2 * Math.PI);
  ctx.fill();
  const g = ctx.createRadialGradient(p.x, p.y - p.size * 0.3, 0, p.x, p.y - p.size * 0.3, p.size * 0.8);
  g.addColorStop(0, 'rgba(255, 244, 200, 0.45)');
  g.addColorStop(1, 'rgba(255, 244, 200, 0)');
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y - p.size * 0.3, p.size * 0.8, p.size * 0.8, 0, 0, 2 * Math.PI);
  ctx.fill();
  ctx.save();
  ctx.translate(p.x, p.y - 0.3 * p.size);
  paintAvatar(ctx as unknown as Paint, p.avatar.form, p.avatar.gift, p.size, { phase: p.phase, facing: p.facing });
  ctx.restore();
  marker(ctx, p.x, p.y - p.size * (p.avatar.form === 'keeper' ? 1.05 : 0.85) - 3 * pulse);
}

/** A small gold chevron over the avatar: you are here. */
function marker(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = '#FFD23F';
  ctx.beginPath();
  ctx.moveTo(x - 7, y - 6);
  ctx.lineTo(x + 7, y - 6);
  ctx.lineTo(x, y + 3);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}
