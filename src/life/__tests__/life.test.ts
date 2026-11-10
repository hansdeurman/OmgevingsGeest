import { describe, expect, it } from 'vitest';
import { BESTIARY, kindOf } from '../bestiary';
import { canBe } from '../creature';
import { hexAt } from '../hexSpace';
import { countsOf, createLife, createWork, lifeModel, lifeStep, populate, release, scaleOf } from '../life';
import { meadow } from './fixtures';

const [cols, rows] = [16, 12];
const n = cols * rows;
/** Sea along the west, a lake in the middle, meadows elsewhere. */
const h = meadow(cols, rows, (i) => (i % cols < 3 ? { sea: 1, height: 0 } : i === 6 * cols + 8 || i === 6 * cols + 9 ? { depth: 1.2 } : {}));
const room = new Float32Array(n).fill(1);
const fresh = (seed = 1) => {
  const life = createLife(h, room, seed);
  populate(life, h);
  return life;
};

describe('populate', () => {
  it('starts every ordinary kind where it can be, as many as it starts with, and no mystic one', () => {
    const life = fresh();
    const counts = countsOf(life);
    BESTIARY.forEach((s, k) => expect(counts[k], s.id).toBe(s.mystic ? 0 : s.start));
    for (const c of life.creatures) expect(canBe(BESTIARY[c.kind], h, hexAt(cols, rows, c.x, c.y)), BESTIARY[c.kind].id).toBe(true);
    expect(new Set(life.creatures.map((c) => c.id)).size).toBe(life.creatures.length);
  });
});

describe('scaleOf', () => {
  it('holds as many as the bestiary says on a small land, more on a wider one, as the root of how much wider', () => {
    expect(scaleOf(h)).toBe(1);
    const wide = meadow(60, 44);
    expect(scaleOf(wide)).toBeCloseTo(Math.sqrt((60 * 44) / 330), 5);
    const life = createLife(wide, new Float32Array(60 * 44).fill(1));
    populate(life, wide);
    const hares = countsOf(life)[kindOf('hare')];
    expect(hares).toBe(Math.round(BESTIARY[kindOf('hare')].start * scaleOf(wide)));
  });
});

describe('release', () => {
  it('lets more of a kind into the world, where it can be', () => {
    const life = fresh();
    const added = release(life, h, kindOf('stormeel'), 3);
    expect(added).toHaveLength(3);
    expect(countsOf(life)[kindOf('stormeel')]).toBe(BESTIARY[kindOf('stormeel')].start + 3);
    added.forEach((c) => expect(canBe(BESTIARY[c.kind], h, hexAt(cols, rows, c.x, c.y))).toBe(true));
  });
});

describe('lifeStep', () => {
  it('moves the creatures, takes out the dead, and leaves an influence on the world', () => {
    const life = fresh();
    const work = createWork(life);
    const before = life.creatures.map((c) => [c.x, c.y]);
    lifeStep(life, h, 0.4, work);
    expect(life.creatures.some((c, k) => c.x !== before[k][0] || c.y !== before[k][1])).toBe(true);
    life.creatures[0].energy = 0;
    const gone = life.creatures[0].id;
    lifeStep(life, h, 0.4, work);
    expect(life.creatures.map((c) => c.id)).not.toContain(gone);
    expect(work.influence.grow.some((g) => g > 0)).toBe(true);
  });

  it('takes in what a guest does: its powers on the world, its pull on the creatures', () => {
    const life = fresh();
    const work = createWork(life);
    const at = { x: 8, y: 5 };
    const guest = {
      mind: () => ({ ...at, kind: -1, reach: 20, pull: 3, calm: 0 }),
      cast: (f: { grow: Float32Array }) => void f.grow.fill(5),
    };
    const near = () => life.creatures.filter((c) => !BESTIARY[c.kind].mystic && Math.hypot(c.x - at.x, c.y - at.y) < 3).length;
    const before = near();
    for (let k = 0; k < 40; k++) lifeStep(life, h, 0.4, work, [guest]);
    expect(work.influence.grow.every((g) => g >= 5)).toBe(true);
    expect(near()).toBeGreaterThan(before + 10);
  });

  it('keeps life going on a mild meadow for a year', () => {
    const life = fresh();
    const work = createWork(life);
    for (let k = 0; k < 640; k++) lifeStep(life, h, ((k / 640 + 0.25) % 1), work);
    const counts = countsOf(life);
    expect(counts[kindOf('hare')]).toBeGreaterThan(4);
    expect(life.creatures.length).toBeGreaterThan(30);
  });
});

describe('lifeModel', () => {
  it('goes back to a moment and on again exactly as it went', () => {
    const life = fresh(5);
    const work = createWork(life);
    const model = lifeModel(life);
    for (let k = 0; k < 30; k++) lifeStep(life, h, 0.4, work);
    const kept = model.save();
    const look = () => JSON.stringify({ c: life.creatures, p: Array.from(life.food.plants) });
    for (let k = 0; k < 40; k++) lifeStep(life, h, 0.4, work);
    const first = look();
    model.restore(kept);
    for (let k = 0; k < 40; k++) lifeStep(life, h, 0.4, work);
    expect(look()).toBe(first);
  });
});
