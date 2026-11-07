import { BESTIARY, type Need } from '../life/bestiary';
import type { CreatureView, LifeSnapshot } from '../life/ecosystem';
import type { Doing } from '../life/creature';
import { ELEMENT_LOOK, POWER_HINT } from '../life/elements';
import { CALLS } from '../life/manifest';

/**
 * What the Life panel shows: the kinds alive now (their elements as
 * coloured chips), the mystic creatures the world is calling and how near
 * they are to coming, the kinds the player can let in, and a line about
 * the creature under the pointer.
 */
export interface Chip {
  colour: string;
  mark: string;
  name: string;
}

export interface KindRow {
  kind: number;
  name: string;
  count: number;
  away: number;
  asleep: number;
  mystic: boolean;
  chips: Chip[];
}

export const chipsOf = (kind: number): Chip[] => BESTIARY[kind].types.map((t) => ({ colour: ELEMENT_LOOK[t].colour, mark: ELEMENT_LOOK[t].mark, name: t }));

/** The kinds alive, mystic ones first, then the most numerous. */
export function kindRows(life: LifeSnapshot): KindRow[] {
  const rows = BESTIARY.flatMap((s, kind): KindRow[] => {
    const count = life.counts[kind];
    if (!count) return [];
    const of = (doing: Doing) => life.creatures.filter((c) => c.kind === kind && c.doing === doing).length;
    return [{ kind, name: s.name, count, away: of('away'), asleep: of('sleep'), mystic: s.mystic, chips: chipsOf(kind) }];
  });
  return rows.sort((a, b) => Number(b.mystic) - Number(a.mystic) || b.count - a.count || a.kind - b.kind);
}

/** What each need is called, for the player. */
export const NEED_NAMES: Record<Need, string> = {
  gloom: 'grey skies',
  drought: 'drought',
  barren: 'bare land',
  frost: 'deep frost',
  gale: 'gales',
  storm: 'a great storm',
  stifling: 'still heat',
  vanishing: 'a kind vanishing',
};

export interface CallRow {
  kind: number;
  name: string;
  need: string;
  /** How near it is to coming, 0–1. */
  share: number;
}

/** The mystic creatures the world is calling, loudest first (those it hardly calls left out). */
export const callRows = (life: LifeSnapshot): CallRow[] =>
  BESTIARY.flatMap((s, kind) => (s.mystic && !life.counts[kind] && life.calling[kind] > 0.05 * CALLS ? [{ kind, name: s.name, need: NEED_NAMES[s.answers!], share: Math.min(1, life.calling[kind] / CALLS) }] : [])).sort(
    (a, b) => b.share - a.share,
  );

/** The kinds the player can let into the world: the ordinary ones (mystic ones come when called). */
export const RELEASABLE = BESTIARY.flatMap((s, kind) => (s.mystic ? [] : [{ kind, name: s.name }]));

const DOING: Record<Doing, string> = { roam: 'roaming', graze: 'feeding', hunt: 'hunting', flee: 'fleeing', sleep: 'asleep', away: 'away for the winter', answer: 'answering the world' };

/** A line about a creature: its name, elements, what it is doing and how fed it is (or what it answers). */
export function describe(c: CreatureView): string {
  const s = BESTIARY[c.kind];
  const types = s.types.join('/');
  const state = s.mystic ? `answers ${NEED_NAMES[s.answers!]}` : `${DOING[c.doing]} · fed ${Math.round(c.energy * 100)}%`;
  return `${s.name} · ${types} · ${state}`;
}

/** What a kind is and can do, for its tooltip. */
export const loreOf = (kind: number) => {
  const s = BESTIARY[kind];
  return `${s.lore}\nPowers: ${s.powers.map((p) => `${p.kind} (${POWER_HINT[p.kind]})`).join('; ')}`;
};
