import { describe as group, expect, it } from 'vitest';
import { BESTIARY, kindOf } from '../../life/bestiary';
import type { CreatureView, LifeSnapshot } from '../../life/ecosystem';
import { ELEMENT_LOOK } from '../../life/elements';
import { CALLS } from '../../life/manifest';
import { callRows, chipsOf, describe, kindRows, loreOf, RELEASABLE } from '../lifePanel';

const c = (id: number, kind: string, doing: CreatureView['doing'] = 'roam'): CreatureView => ({ id, kind: kindOf(kind), x: 0, y: 0, heading: 0, energy: 0.64, doing, age: 1 });
const snapshot = (creatures: CreatureView[], calling: Record<string, number> = {}): LifeSnapshot => {
  const counts = new Int32Array(BESTIARY.length);
  creatures.forEach((x) => counts[x.kind]++);
  return { creatures, counts, plants: new Float32Array(0), room: new Float32Array(0), calling: Float32Array.from(BESTIARY, (s) => calling[s.id] ?? 0) };
};

group('kindRows', () => {
  it('lists the kinds alive, mystic first then the most, with how many sleep or are away', () => {
    const rows = kindRows(snapshot([c(1, 'hare'), c(2, 'hare'), c(3, 'swallow', 'away'), c(4, 'phoenix'), c(5, 'salamander', 'sleep')]));
    expect(rows.map((r) => r.name)).toEqual(['Phoenix', 'Meadow Hare', 'Ember Salamander', 'Gale Swallow']);
    expect(rows[1].count).toBe(2);
    expect(rows[3].away).toBe(1);
    expect(rows[2].asleep).toBe(1);
  });

  it('shows each kind’s elements as coloured chips', () => {
    expect(chipsOf(kindOf('stormeel')).map((x) => x.colour)).toEqual([ELEMENT_LOOK.water.colour, ELEMENT_LOOK.electric.colour]);
  });
});

group('callRows', () => {
  it('lists the mystic creatures the world calls, loudest first, and what for', () => {
    const rows = callRows(snapshot([], { phoenix: CALLS / 2, raindragon: CALLS * 2, golem: 0.01 }));
    expect(rows.map((r) => [r.name, r.share])).toEqual([
      ['Rain Dragon', 1],
      ['Phoenix', 0.5],
    ]);
    expect(rows[1].need).toBe('deep frost');
  });

  it('leaves out one already here', () => {
    expect(callRows(snapshot([c(1, 'phoenix')], { phoenix: CALLS / 2 }))).toEqual([]);
  });
});

group('describe', () => {
  it('says what a creature is and is doing', () => {
    expect(describe(c(1, 'sparkfox', 'hunt'))).toBe('Spark Fox · electric · hunting · fed 64%');
    expect(describe(c(2, 'phoenix', 'answer'))).toBe('Phoenix · fire · answers deep frost');
    expect(loreOf(kindOf('phoenix'))).toContain('warm');
  });

  it('lets in only ordinary kinds', () => {
    expect(RELEASABLE.length).toBe(BESTIARY.filter((s) => !s.mystic).length);
  });
});
