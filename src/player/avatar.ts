import type { Power } from '../life/bestiary';
import type { Element } from '../life/elements';
import type { Habitat } from '../life/habitat';
import { inside, ROW } from '../life/hexSpace';
import type { Guest } from '../life/life';
import { castPower, mindOf, type Influence } from '../life/powers';

/**
 * The player in the world: a spirit beast, or a keeper (a human, or a god,
 * in human shape). It walks where it is sent and works gifts on the world
 * around it, mostly on the weather and the land (rain, sun, frost, wind,
 * growth), a little on the creatures' minds (calm). Gifts draw on its
 * spirit, which comes back while it rests. Distance in hex spacings, time
 * in steps, as for the creatures.
 */
export type Form = 'beast' | 'keeper';
export type Gift = 'rain' | 'sun' | 'frost' | 'wind' | 'grow' | 'calm';

export interface Avatar {
  x: number;
  y: number;
  heading: number;
  /** Where it is walking to, if anywhere. */
  target?: { x: number; y: number };
  /** The gift it is working, if any. */
  gift: Gift | null;
  /** What it has left to work gifts with, 0–1. */
  spirit: number;
  form: Form;
}

export interface GiftKind {
  name: string;
  hint: string;
  /** Whose colour it shows in. */
  element: Element;
  key: string;
  icon: string;
  powers: readonly Power[];
}

/** The gifts, each worked as creatures' powers are, only stronger. */
export const GIFTS: Record<Gift, GiftKind> = {
  rain: { name: 'Rain', hint: 'Gathers clouds and makes them rain', element: 'water', key: '1', icon: '🌧', powers: [{ kind: 'mist', strength: 0.012, reach: 2 }, { kind: 'rain', strength: 0.35, reach: 2 }] },
  sun: { name: 'Sun', hint: 'Breaks the clouds, warms the land, melts snow', element: 'light', key: '2', icon: '☀️', powers: [{ kind: 'shine', strength: 1.5, reach: 2 }, { kind: 'warm', strength: 0.8, reach: 2 }] },
  frost: { name: 'Frost', hint: 'Cools the air, freezes lakes, brings snow', element: 'water', key: '3', icon: '❄️', powers: [{ kind: 'chill', strength: 0.9, reach: 2 }, { kind: 'freeze', strength: 0.25, reach: 2 }, { kind: 'rain', strength: 0.15, reach: 2 }] },
  wind: { name: 'Wind', hint: 'Drives the wind the way you face', element: 'wind', key: '4', icon: '💨', powers: [{ kind: 'gust', strength: 0.12, reach: 2 }] },
  grow: { name: 'Grow', hint: 'Makes plants grow fast', element: 'organic', key: '5', icon: '🌱', powers: [{ kind: 'grow', strength: 3, reach: 2 }] },
  calm: { name: 'Calm', hint: 'Draws creatures near; none hunts around you', element: 'psychic', key: '6', icon: '🕊', powers: [{ kind: 'lure', strength: 1.5, reach: 4 }, { kind: 'calm', strength: 1, reach: 3 }] },
};

export const GIFT_ORDER = Object.keys(GIFTS) as Gift[];

/** Each form's way: how fast it walks, and how much further its gifts reach. */
export const FORMS: Record<Form, { name: string; speed: number; reach: number }> = {
  beast: { name: 'Spirit beast', speed: 0.4, reach: 0 },
  keeper: { name: 'Keeper', speed: 0.25, reach: 1 },
};

/** Spirit a gift takes per step, and that comes back per step at rest. */
export const SPIRIT = { cost: 0.005, back: 0.003 };

export const createAvatar = (x: number, y: number, form: Form = 'beast'): Avatar => ({ x, y, heading: 0, gift: null, spirit: 1, form });

/** One step: on towards its target (and stop there), kept on the map; its gift draws on its spirit (and stops when it is spent), or its spirit comes back. */
export function stepAvatar(a: Avatar, cols: number, rows: number): void {
  if (a.target) {
    const [dx, dy] = [a.target.x - a.x, a.target.y - a.y];
    const d = Math.hypot(dx, dy);
    const speed = FORMS[a.form].speed;
    if (d > 1e-6) a.heading = Math.atan2(dy, dx);
    if (d <= speed) [a.x, a.y, a.target] = [a.target.x, a.target.y, undefined];
    else [a.x, a.y] = [a.x + (dx / d) * speed, a.y + (dy / d) * speed];
  }
  if (!inside(cols, rows, a.x, a.y)) [a.x, a.y] = [Math.max(0, Math.min(cols - 0.5, a.x)), Math.max(0, Math.min((rows - 1) * ROW, a.y))];
  if (a.gift) {
    a.spirit = Math.max(0, a.spirit - SPIRIT.cost);
    if (a.spirit === 0) a.gift = null;
  } else a.spirit = Math.min(1, a.spirit + SPIRIT.back);
}

/** The powers its gift works now, reaching as far as its form lets it. */
export const powersOf = (a: Avatar): Power[] => (a.gift && a.spirit > 0 ? GIFTS[a.gift].powers.map((p) => ({ ...p, reach: p.reach + FORMS[a.form].reach })) : []);

/** The avatar as a guest among the creatures: its gift on the world and on their minds. */
export const avatarGuest = (a: Avatar): Guest => ({
  mind: (population) => mindOf(powersOf(a), a, -1, population),
  cast: (f: Influence, h: Habitat) => powersOf(a).forEach((p) => castPower(f, p, a, h.cols, h.rows)),
});

export const copyAvatar = (a: Avatar): Avatar => ({ ...a, target: a.target && { ...a.target } });
