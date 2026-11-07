import { BESTIARY, preyOf, type Power } from './bestiary';
import { vanishingKinds, type Population } from './population';
import type { Mind } from './behaviour';
import type { Creature } from './creature';
import type { PowerKind } from './elements';
import type { Habitat } from './habitat';
import { centreOf, ROW } from './hexSpace';

/**
 * What creatures' powers do to the world this step, per hex: heat they add
 * (or take: below 0), a push on the wind and how much of it they still, water
 * they lift into the air, the share of the cloud they make rain or thin out,
 * the share of standing water they freeze, and how much faster plants grow.
 * Mind powers act on other creatures instead (`mindsOf`). The world takes
 * these in through `touchWorld`.
 */
export interface Influence {
  heat: Float32Array;
  gustX: Float32Array;
  gustY: Float32Array;
  still: Float32Array;
  mist: Float32Array;
  rain: Float32Array;
  thin: Float32Array;
  freeze: Float32Array;
  grow: Float32Array;
}

export const createInfluence = (n: number): Influence => ({
  heat: new Float32Array(n),
  gustX: new Float32Array(n),
  gustY: new Float32Array(n),
  still: new Float32Array(n),
  mist: new Float32Array(n),
  rain: new Float32Array(n),
  thin: new Float32Array(n),
  freeze: new Float32Array(n),
  grow: new Float32Array(n),
});

type WorldPower = Exclude<PowerKind, 'lure' | 'scare' | 'calm'>;
/** Share of the cloud a shine of 1 thins per step, and growth a spark brings with its rain. */
const SHINE_THINS = 0.05;
const SPARK_GROWS = 2;

/** Each power's work on hex `i`, at strength `s` (its own, weakened by distance), by creature `c`. */
const EFFECTS: Record<WorldPower, (f: Influence, i: number, s: number, c: Creature) => void> = {
  warm: (f, i, s) => (f.heat[i] += s),
  chill: (f, i, s) => (f.heat[i] -= s),
  gust: (f, i, s, c) => {
    f.gustX[i] += Math.cos(c.heading) * s;
    f.gustY[i] += Math.sin(c.heading) * s;
  },
  shelter: (f, i, s) => (f.still[i] = 1 - (1 - f.still[i]) * (1 - Math.min(1, s))),
  shine: (f, i, s) => {
    f.thin[i] += SHINE_THINS * s;
    f.grow[i] += s;
  },
  spark: (f, i, s) => {
    f.rain[i] += s;
    f.grow[i] += SPARK_GROWS * s;
  },
  mist: (f, i, s) => (f.mist[i] += s),
  rain: (f, i, s) => (f.rain[i] += s),
  freeze: (f, i, s) => (f.freeze[i] += s),
  grow: (f, i, s) => (f.grow[i] += s),
};

const isWorldPower = (k: PowerKind): k is WorldPower => k in EFFECTS;

/** The hexes within `reach` of (x, y), each with how strongly a power reaches it there (1 at its centre, less further out). */
export function within(cols: number, rows: number, x: number, y: number, reach: number, visit: (i: number, w: number) => void): void {
  const [r0, r1] = [Math.max(0, Math.floor((y - reach) / ROW) - 1), Math.min(rows - 1, Math.ceil((y + reach) / ROW) + 1)];
  for (let row = r0; row <= r1; row++)
    for (let col = Math.max(0, Math.floor(x - reach) - 1); col <= Math.min(cols - 1, Math.ceil(x + reach) + 1); col++) {
      const i = row * cols + col;
      const p = centreOf(cols, i);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= reach + 0.5) visit(i, 1 - d / (reach + 1));
    }
}

/** This step's influence of all the creatures awake, afresh. */
export function castPowers(f: Influence, creatures: readonly Creature[], h: Habitat): void {
  Object.values(f).forEach((a: Float32Array) => a.fill(0));
  for (const c of creatures) {
    if (c.doing === 'sleep' || c.doing === 'away' || c.energy <= 0) continue;
    for (const p of BESTIARY[c.kind].powers) {
      if (!isWorldPower(p.kind)) continue;
      const effect = EFFECTS[p.kind];
      within(h.cols, h.rows, c.x, c.y, p.reach, (i, w) => effect(f, i, p.strength * w, c));
    }
  }
}

/** Whom a mind power works on: its prey, the kinds about to vanish, or (undefined) all others. */
const onWhom = (p: Power, kind: number, population: Population) => (p.on === 'prey' ? preyOf(BESTIARY[kind]) : p.on === 'few' ? vanishingKinds(population) : undefined);

/** The creatures that work on others' minds: how far, pulling or pushing how hard and whom, and how far around they keep hunting from happening. */
export function mindsOf(creatures: readonly Creature[], population: Population = { counts: [], peaks: [] }): Mind[] {
  const minds: Mind[] = [];
  for (const c of creatures) {
    const powers = BESTIARY[c.kind].powers.filter((p) => p.kind === 'lure' || p.kind === 'scare' || p.kind === 'calm');
    if (!powers.length || c.doing === 'sleep' || c.doing === 'away' || c.energy <= 0) continue;
    const pulls = powers.filter((p) => p.kind !== 'calm');
    minds.push({
      x: c.x,
      y: c.y,
      kind: c.kind,
      reach: Math.max(0, ...pulls.map((p) => p.reach)),
      pull: pulls.reduce((sum, p) => sum + (p.kind === 'lure' ? p.strength : -p.strength), 0),
      pulls: pulls.length ? onWhom(pulls[0], c.kind, population) : undefined,
      calm: Math.max(0, ...powers.filter((p) => p.kind === 'calm').map((p) => p.reach)),
    });
  }
  return minds;
}
