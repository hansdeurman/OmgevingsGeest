import type { Body, Species } from '../life/bestiary';
import { ELEMENT_LOOK } from '../life/elements';

/**
 * Creatures drawn flat and bright: each body a few plain shapes, no
 * outlines, big round eyes, coloured by its elements (the first its body,
 * the second its marks). A body is data: parts in a unit box (length 1,
 * facing east, feet at y 0.3), each filled in one of the creature's colours;
 * wings flap with the phase. Mystic creatures glow.
 */
export type Role = 'main' | 'shade' | 'accent' | 'light' | 'white' | 'dark';

export interface Part {
  fill: Role;
  /** An ellipse: centre, radii, turn (rad). */
  e?: readonly [number, number, number, number, number];
  /** A polygon: x, y, x, y, … */
  p?: readonly number[];
  /** How far it flaps (share of its height, about its centre line), as the phase goes round. */
  flap?: number;
  /** Part of an eye: shut while asleep. */
  eye?: boolean;
}

export type Palette = Record<Role, string>;

/** The canvas calls the art needs: a 2D context, or a stand-in for one. */
export interface Paint {
  fillStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
  beginPath(): void;
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(): void;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
}

const E = (fill: Role, cx: number, cy: number, rx: number, ry: number, turn = 0, flap?: number): Part => ({ fill, e: [cx, cy, rx, ry, turn], flap });
const P = (fill: Role, ...p: number[]): Part => ({ fill, p });
const eye = (x: number, y: number, r: number): Part[] => [
  { ...E('white', x, y, r, r), eye: true },
  { ...E('dark', x + r * 0.3, y + r * 0.05, r * 0.55, r * 0.6), eye: true },
];
/** A curved band (a horn, a curl): the ring around (cx, cy) of radius `r` and width `w`, from angle `a0` to `a1`. */
function arc(fill: Role, cx: number, cy: number, r: number, a0: number, a1: number, w: number): Part {
  const n = 8;
  const at = (k: number, rr: number) => [cx + rr * Math.cos(a0 + ((a1 - a0) * k) / n), cy + rr * Math.sin(a0 + ((a1 - a0) * k) / n)];
  const outer = Array.from({ length: n + 1 }, (_, k) => at(k, r + w / 2));
  const inner = Array.from({ length: n + 1 }, (_, k) => at(n - k, Math.max(0.005, r - (w / 2) * (1 - k / n))));
  return P(fill, ...outer.flat(), ...inner.flat());
}

/** Parts moved by (dx, dy). */
const shift = (parts: Part[], dx: number, dy: number): Part[] =>
  parts.map((q) => ({ ...q, e: q.e && [q.e[0] + dx, q.e[1] + dy, q.e[2], q.e[3], q.e[4]], p: q.p?.map((v, k) => v + (k % 2 ? dy : dx)) }));
const legs = (xs: number[], top: number, long: number, wide = 0.035): Part[] => xs.map((x) => E('shade', x, top + long / 2, wide, long / 2));

/** A four-legged body, standing on legs `legs` long: legs, tail, body and belly, head and snout, ears or horns, eye. */
function beast(o: { body: [number, number]; head: [number, number, number]; legs: number; tail?: Part[]; ears?: Part[]; over?: Part[] }): Part[] {
  return shift(standing(o), 0, 0.3 - o.body[1] * 0.5 - o.legs);
}

function standing(o: { body: [number, number]; head: [number, number, number]; legs: number; tail?: Part[]; ears?: Part[]; over?: Part[] }): Part[] {
  const [rx, ry] = o.body;
  const [hx, hy, r] = o.head;
  return [
    ...legs([-rx * 0.65, -rx * 0.3, rx * 0.35, rx * 0.7], ry * 0.5, o.legs),
    ...(o.tail ?? []),
    E('main', 0, 0, rx, ry),
    E('light', 0.02, ry * 0.45, rx * 0.7, ry * 0.45),
    ...(o.over ?? []),
    E('main', hx, hy, r, r * 0.9),
    E('light', hx + r * 0.7, hy + r * 0.3, r * 0.45, r * 0.35),
    ...(o.ears ?? []),
    ...eye(hx + r * 0.3, hy - r * 0.15, r * 0.28),
  ];
}

const FOX_EARS = [P('main', 0.22, -0.16, 0.24, -0.32, 0.3, -0.18), P('main', 0.3, -0.18, 0.35, -0.33, 0.38, -0.16), P('accent', 0.25, -0.18, 0.25, -0.27, 0.28, -0.18)];

/** A bird from the side: tail, body, wing (flapping), head, beak, eye. */
const bird = (crest = false): Part[] => [
  P('shade', -0.2, -0.02, -0.46, -0.1, -0.44, 0.08),
  E('main', 0, 0, 0.24, 0.13, -0.15),
  E('light', 0.03, 0.06, 0.16, 0.07, -0.15),
  E('shade', -0.04, -0.06, 0.2, 0.09, -0.35, 0.9),
  E('main', 0.22, -0.1, 0.1, 0.1),
  P('accent', 0.3, -0.13, 0.42, -0.08, 0.3, -0.05),
  ...(crest ? [P('accent', 0.16, -0.18, 0.12, -0.36, 0.24, -0.2), P('accent', 0.2, -0.19, 0.24, -0.38, 0.28, -0.18)] : []),
  ...eye(0.25, -0.12, 0.035),
];

/** A long body of round segments along a gentle wave, head at the front. */
function serpent(n: number, head: Part[]): Part[] {
  const body = Array.from({ length: n }, (_, k) => {
    const t = k / (n - 1);
    return E(k % 2 ? 'main' : 'shade', -0.45 + 0.8 * t, 0.06 * Math.sin(t * 2 * Math.PI * 1.5), 0.07 + 0.04 * t, 0.07 + 0.04 * t);
  });
  return [...body, ...head];
}

export const BODIES: Record<Body, readonly Part[]> = {
  hare: beast({
    body: [0.28, 0.18],
    head: [0.26, -0.12, 0.13],
    legs: 0.1,
    tail: [E('white', -0.3, -0.04, 0.07, 0.07)],
    ears: [E('main', 0.2, -0.36, 0.045, 0.15, -0.2), E('light', 0.2, -0.35, 0.022, 0.1, -0.2), E('main', 0.29, -0.36, 0.045, 0.15, 0.15)],
  }),
  fox: beast({
    body: [0.3, 0.13],
    head: [0.3, -0.1, 0.12],
    legs: 0.16,
    tail: [E('main', -0.36, -0.06, 0.18, 0.075, -0.45), E('white', -0.5, -0.13, 0.06, 0.045, -0.45)],
    ears: FOX_EARS,
  }),
  kitsune: beast({
    body: [0.3, 0.13],
    head: [0.3, -0.1, 0.12],
    legs: 0.16,
    tail: [-0.75, -0.4, -0.05].flatMap((turn) => [E('main', -0.33, -0.1 + turn * 0.12, 0.2, 0.06, turn), E('accent', -0.48, -0.1 + turn * 0.3, 0.06, 0.04, turn)]),
    ears: FOX_EARS,
    over: [E('accent', 0.0, -0.05, 0.05, 0.03)],
  }),
  goat: beast({
    body: [0.28, 0.16],
    head: [0.28, -0.16, 0.11],
    legs: 0.16,
    tail: [E('shade', -0.29, -0.07, 0.05, 0.03, -0.6)],
    ears: [arc('accent', 0.19, -0.27, 0.075, -0.2, -3.6, 0.04), P('light', 0.33, -0.08, 0.31, 0.04, 0.37, -0.06), E('shade', 0.2, -0.14, 0.05, 0.025, 0.4)],
  }),
  deer: beast({
    body: [0.27, 0.14],
    head: [0.3, -0.22, 0.1],
    legs: 0.22,
    over: [E('main', 0.22, -0.12, 0.06, 0.12, 0.5)],
    ears: [P('accent', 0.26, -0.3, 0.2, -0.5, 0.12, -0.56, 0.22, -0.46, 0.24, -0.6, 0.29, -0.31), P('accent', 0.32, -0.3, 0.36, -0.52, 0.44, -0.58, 0.38, -0.47, 0.35, -0.3)],
    tail: [E('white', -0.27, -0.05, 0.04, 0.05)],
  }),
  lion: beast({
    body: [0.32, 0.17],
    head: [0.31, -0.12, 0.13],
    legs: 0.16,
    tail: [P('main', -0.3, -0.02, -0.5, -0.16, -0.48, -0.12), E('shade', -0.5, -0.17, 0.05, 0.05)],
    over: [E('shade', 0.28, -0.12, 0.22, 0.22), E('accent', 0.28, -0.12, 0.17, 0.17)],
  }),
  otter: [
    ...legs([-0.2, 0.18], 0.12, 0.08, 0.04),
    P('shade', -0.28, -0.02, -0.55, 0.12, -0.28, 0.08),
    E('main', 0, 0.04, 0.32, 0.11),
    E('light', 0.06, 0.09, 0.22, 0.05),
    E('main', 0.3, -0.04, 0.11, 0.1),
    E('light', 0.37, 0.0, 0.06, 0.045),
    E('shade', 0.25, -0.12, 0.03, 0.03),
    ...eye(0.33, -0.07, 0.03),
  ],
  bird: bird(true),
  owl: [
    E('shade', -0.17, 0.02, 0.09, 0.2, 0.2, 0.6),
    E('shade', 0.17, 0.02, 0.09, 0.2, -0.2, 0.6),
    E('main', 0, 0, 0.2, 0.26),
    E('light', 0, 0.1, 0.13, 0.13),
    P('main', -0.16, -0.16, -0.12, -0.34, -0.04, -0.2),
    P('main', 0.16, -0.16, 0.12, -0.34, 0.04, -0.2),
    E('accent', -0.07, -0.08, 0.09, 0.09),
    E('accent', 0.07, -0.08, 0.09, 0.09),
    ...eye(-0.07, -0.08, 0.06),
    ...eye(0.07, -0.08, 0.06),
    P('shade', -0.025, -0.02, 0.025, -0.02, 0, 0.03),
  ],
  moth: [
    E('accent', -0.08, 0.07, 0.14, 0.11, 0.5, 0.5),
    E('main', -0.06, -0.12, 0.22, 0.16, -0.6, 0.6),
    E('light', -0.07, -0.13, 0.11, 0.07, -0.6, 0.6),
    E('shade', 0, 0, 0.12, 0.05),
    P('shade', 0.1, -0.02, 0.22, -0.16, 0.12, -0.03),
    ...eye(0.1, -0.01, 0.035),
  ],
  lizard: [
    ...legs([-0.15, -0.1, 0.12, 0.17], 0.04, 0.12, 0.03),
    P('main', -0.2, -0.04, -0.58, 0.06, -0.2, 0.06),
    E('main', 0, 0.01, 0.24, 0.08),
    E('accent', -0.08, -0.03, 0.04, 0.025),
    E('accent', 0.06, -0.04, 0.04, 0.025),
    E('main', 0.27, -0.02, 0.1, 0.065),
    E('light', 0.02, 0.05, 0.18, 0.03),
    ...eye(0.28, -0.05, 0.028),
  ],
  frog: [
    E('shade', -0.16, 0.16, 0.14, 0.08),
    E('main', 0, 0.04, 0.24, 0.17),
    E('light', 0.04, 0.12, 0.17, 0.08),
    E('accent', -0.08, -0.03, 0.05, 0.03),
    E('main', 0.08, -0.14, 0.07, 0.07),
    E('main', 0.2, -0.13, 0.07, 0.07),
    ...eye(0.08, -0.15, 0.05),
    ...eye(0.2, -0.14, 0.05),
    E('shade', 0.16, 0.06, 0.08, 0.012),
    E('shade', 0.12, 0.22, 0.08, 0.035),
  ],
  fish: [
    P('main', -0.35, 0, -0.52, -0.12, -0.5, 0.12),
    E('main', 0, 0, 0.4, 0.1),
    P('accent', -0.25, -0.02, -0.15, -0.08, -0.05, -0.02, 0.05, -0.08, 0.15, -0.02),
    E('light', 0.05, 0.05, 0.28, 0.04),
    P('shade', -0.12, -0.08, 0.05, -0.18, 0.12, -0.08),
    ...eye(0.3, -0.03, 0.03),
  ],
  serpent: serpent(9, [E('main', 0.42, -0.02, 0.12, 0.1), P('accent', 0.38, -0.1, 0.32, -0.26, 0.44, -0.11), E('light', 0.5, 0.02, 0.06, 0.04), ...eye(0.44, -0.04, 0.035)]),
  dragon: serpent(10, [
    ...legs([-0.1, 0.15], 0.05, 0.1, 0.03),
    E('main', 0.43, -0.06, 0.13, 0.1),
    P('accent', 0.38, -0.13, 0.3, -0.32, 0.42, -0.15),
    P('accent', 0.44, -0.14, 0.42, -0.34, 0.5, -0.15),
    P('light', 0.52, 0.0, 0.66, 0.1, 0.5, 0.03),
    E('light', 0.53, -0.02, 0.06, 0.04),
    ...eye(0.45, -0.08, 0.035),
  ]),
  whale: [
    P('shade', -0.4, -0.02, -0.56, -0.14, -0.52, 0.0, -0.58, 0.1),
    E('main', 0, 0, 0.44, 0.2),
    E('light', 0.06, 0.1, 0.32, 0.09),
    E('accent', -0.1, -0.08, 0.05, 0.03),
    E('accent', 0.05, -0.12, 0.04, 0.025),
    E('shade', 0.02, 0.14, 0.12, 0.05, 0.4, 0.7),
    ...eye(0.3, -0.02, 0.035),
  ],
  golem: [
    E('shade', -0.14, 0.2, 0.09, 0.1),
    E('shade', 0.14, 0.2, 0.09, 0.1),
    E('shade', -0.27, 0.02, 0.09, 0.15, 0.3),
    E('main', 0, -0.02, 0.24, 0.22),
    E('light', -0.06, -0.08, 0.1, 0.07),
    E('main', 0.03, -0.3, 0.13, 0.11),
    E('shade', 0.27, 0.02, 0.09, 0.15, -0.3),
    E('accent', 0.0, -0.31, 0.03, 0.03),
    E('accent', 0.08, -0.31, 0.03, 0.03),
    E('accent', 0.05, 0.02, 0.06, 0.06),
  ],
  wisp: [
    P('main', -0.4, 0.05, -0.05, -0.18, 0.05, 0.16),
    E('main', 0.08, 0, 0.18, 0.18),
    E('light', 0.1, 0, 0.11, 0.11),
    E('accent', 0.1, 0, 0.05, 0.05),
    ...eye(0.06, -0.03, 0.03),
    ...eye(0.15, -0.03, 0.03),
  ],
  tortoise: [
    ...legs([-0.2, -0.08, 0.1, 0.22], 0.08, 0.14, 0.05),
    E('light', 0.36, -0.02, 0.1, 0.08),
    E('shade', 0, 0.02, 0.36, 0.2),
    E('main', 0, -0.06, 0.3, 0.13),
    P('accent', -0.2, -0.12, -0.12, -0.42, -0.04, -0.12),
    P('accent', -0.04, -0.15, 0.06, -0.52, 0.16, -0.15),
    P('light', 0.1, -0.12, 0.16, -0.32, 0.22, -0.1),
    E('shade', -0.12, -0.12, 0.02, 0.05),
    ...eye(0.39, -0.04, 0.03),
  ],
};

/** Mix two #rrggbb colours: `t` of the way from `a` to `b`. */
export function mixColour(a: string, b: string, t: number): string {
  const [x, y] = [a, b].map((c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16)));
  return '#' + x.map((v, k) => Math.round(v + (y[k] - v) * t).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** A creature's colours: its first element for its body, its second (or a deeper shade of the first) for its marks. */
export function paletteOf(s: Species): Palette {
  const first = ELEMENT_LOOK[s.types[0]];
  const second = s.types[1] ? ELEMENT_LOOK[s.types[1]].colour : first.shade;
  return { main: first.colour, shade: first.shade, accent: second, light: mixColour(first.colour, '#FFFFFF', 0.5), white: '#FFFFFF', dark: '#1B1B3A' };
}

const TURN = 2 * Math.PI;

function fillPart(ctx: Paint, part: Part, palette: Palette, phase: number, shut: boolean): void {
  const flap = part.flap ? 1 - part.flap * 0.5 * (1 + Math.sin(phase * TURN)) : 1;
  ctx.fillStyle = palette[part.fill];
  ctx.beginPath();
  if (part.e) {
    const [cx, cy, rx, ry, turn] = part.e;
    // A shut eye: its white a thin lid, its pupil gone.
    if (shut && part.eye && part.fill === 'dark') return;
    ctx.ellipse(cx, cy, rx, shut && part.eye ? ry * 0.2 : ry * flap, turn, 0, TURN);
  } else if (part.p) {
    const p = part.p;
    const mid = p.reduce((s, v, k) => (k % 2 ? s + v : s), 0) / (p.length / 2);
    for (let k = 0; k < p.length; k += 2) (k ? ctx.lineTo : ctx.moveTo).call(ctx, p[k], mid + (p[k + 1] - mid) * flap);
    ctx.closePath();
  }
  ctx.fill();
}

export interface Pose {
  /** Share of a wingbeat or stride, 0–1. */
  phase: number;
  /** -1: facing west. */
  facing: 1 | -1;
  asleep?: boolean;
}

/** Draw a creature of kind `s` at the origin, `size` px long, in `pose`. */
export function paintCreature(ctx: Paint, s: Species, size: number, pose: Pose): void {
  const palette = paletteOf(s);
  ctx.save();
  ctx.scale(size * pose.facing, size);
  for (const part of BODIES[s.body]) fillPart(ctx, part, palette, pose.phase, !!pose.asleep);
  ctx.restore();
}
