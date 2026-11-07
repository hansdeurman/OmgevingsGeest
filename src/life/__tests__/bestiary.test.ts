import { describe, expect, it } from 'vitest';
import { BESTIARY, kindOf, preyOf } from '../bestiary';
import { ELEMENTS, POWERS_OF } from '../elements';

describe('BESTIARY', () => {
  it('names every kind once', () => {
    expect(new Set(BESTIARY.map((s) => s.id)).size).toBe(BESTIARY.length);
    expect(new Set(BESTIARY.map((s) => s.name)).size).toBe(BESTIARY.length);
  });

  it('has an ordinary and a mystic creature of every single element, and blends of two', () => {
    for (const e of ELEMENTS) {
      const single = BESTIARY.filter((s) => s.types.length === 1 && s.types[0] === e);
      expect(single.some((s) => !s.mystic)).toBe(true);
      expect(single.some((s) => s.mystic)).toBe(true);
    }
    expect(BESTIARY.filter((s) => s.types.length >= 2).length).toBeGreaterThanOrEqual(4);
  });

  it('gives each a power of its own elements', () => {
    for (const s of BESTIARY) {
      expect(s.powers.length).toBeGreaterThan(0);
      const can = new Set(s.types.flatMap((t) => POWERS_OF[t]));
      s.powers.forEach((p) => expect(can.has(p.kind), `${s.id}: ${p.kind}`).toBe(true));
    }
  });

  it('lets every ordinary creature eat, and live long enough to breed', () => {
    for (const s of BESTIARY.filter((s) => !s.mystic)) {
      const { plants = 0, fish = 0, elements = 0, prey = [] } = s.diet;
      expect(plants + fish + elements + prey.length, s.id).toBeGreaterThan(0);
      expect(Math.max(plants, fish, elements, prey.length ? s.burn * 2 : 0), s.id).toBeGreaterThan(s.burn);
      expect(s.matures).toBeLessThan(s.lifespan / 2);
      expect(s.comfort[0]).toBeLessThan(s.comfort[1]);
    }
  });

  it('calls each mystic creature by its own need, and none of them is born', () => {
    const mystic = BESTIARY.filter((s) => s.mystic);
    expect(new Set(mystic.map((s) => s.answers)).size).toBe(mystic.length);
    mystic.forEach((s) => expect([s.start, s.broods]).toEqual([0, 0]));
  });
});

describe('preyOf', () => {
  it('finds the kinds a hunter hunts', () => {
    const fox = BESTIARY[kindOf('sparkfox')];
    expect(preyOf(fox).map((k) => BESTIARY[k].id)).toEqual(['hare', 'glowmoth']);
    expect(() => kindOf('unicorn')).toThrow();
  });

  it('only hunts kinds that are born, and smaller than the hunter', () => {
    for (const s of BESTIARY) for (const k of preyOf(s)) expect(BESTIARY[k].mystic || BESTIARY[k].size >= s.size, `${s.id} hunts ${BESTIARY[k].id}`).toBe(false);
  });
});
