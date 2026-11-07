import { describe, expect, it } from 'vitest';
import { BESTIARY, kindOf } from '../../life/bestiary';
import type { CreatureView } from '../../life/ecosystem';
import { createAvatar } from '../../player/avatar';
import { creatureAt, FRAMES, placeAvatar, placeCreatures, type Projection } from '../creatureLayer';

const view: Projection = { toScreen: (x, y) => ({ x: 100 * x, y: 50 * y }), spacing: 40 };
const at = (id: number, kind: string, x: number, y: number, more: Partial<CreatureView> = {}): CreatureView => ({ id, kind: kindOf(kind), x, y, heading: 0, energy: 0.8, doing: 'roam', age: 100, ...more });

describe('placeCreatures', () => {
  it('glides a creature from where it was to where it is, facing the way it goes', () => {
    const [p] = placeCreatures([at(1, 'hare', 1, 1)], [at(1, 'hare', 0.5, 1)], 0.5, view, 0);
    expect(p.x).toBeCloseTo(75);
    expect(p.groundY).toBeCloseTo(50);
    expect(p.facing).toBe(-1);
    expect(p.alpha).toBe(1);
  });

  it('puts a creature that jumped far, or is new, where it is; the new one fading in', () => {
    const [far] = placeCreatures([at(1, 'hare', 1, 1)], [at(1, 'hare', 6, 1)], 0.5, view, 0);
    expect(far.x).toBeCloseTo(600);
    const [fresh] = placeCreatures([], [at(2, 'hare', 1, 1)], 0.25, view, 0);
    expect(fresh.alpha).toBeCloseTo(0.5);
  });

  it('lifts fliers into the air above their shadow, draws mystic ones bigger, leaves out those away', () => {
    const placed = placeCreatures(undefined, [at(1, 'swallow', 1, 1), at(2, 'phoenix', 2, 1), at(3, 'swallow', 3, 1, { doing: 'away' }), at(4, 'hare', 1, 1)], 1, view, 0);
    expect(placed.map((p) => p.id).sort()).toEqual([1, 2, 4]);
    const swallow = placed.find((p) => p.id === 1)!;
    expect(swallow.y).toBeLessThan(swallow.groundY);
    const phoenix = placed.find((p) => p.id === 2)!;
    expect(phoenix.mystic).toBe(true);
    expect(phoenix.size).toBeGreaterThan(swallow.size * 2);
    expect(phoenix.size).toBeCloseTo(BESTIARY[kindOf('phoenix')].size * 2 * 40);
    expect(phoenix.groundY - phoenix.y).toBeGreaterThan(swallow.groundY - swallow.y);
  });

  it('steps through its poses as time goes, but not asleep; back to front by the ground', () => {
    const frames = new Set([0, 0.1, 0.2, 0.3].map((time) => placeCreatures(undefined, [at(1, 'swallow', 1, 1)], 1, view, time)[0].frame));
    expect(frames.size).toBeGreaterThan(1);
    [...frames].forEach((f) => expect(f).toBeLessThan(FRAMES));
    const asleep = new Set([0, 0.1, 0.2, 0.3].map((time) => placeCreatures(undefined, [at(1, 'salamander', 1, 1, { doing: 'sleep' })], 1, view, time)[0].frame));
    expect(asleep.size).toBe(1);
    const order = placeCreatures(undefined, [at(1, 'hare', 1, 3), at(2, 'hare', 1, 1)], 1, view, 0).map((p) => p.id);
    expect(order).toEqual([2, 1]);
  });
});

describe('creatureAt', () => {
  it('finds the creature drawn under a point, and none far from all', () => {
    const placed = placeCreatures(undefined, [at(1, 'hare', 1, 1), at(2, 'hare', 3, 1)], 1, view, 0);
    expect(creatureAt(placed, 300, 45)?.id).toBe(2);
    expect(creatureAt(placed, 200, 300)).toBeUndefined();
  });
});

describe('placeAvatar', () => {
  it('glides the avatar on, big, with the ring its gift reaches and where it walks to', () => {
    const [was, now] = [createAvatar(1, 1), { ...createAvatar(1.4, 1), gift: 'rain' as const, target: { x: 4, y: 1 } }];
    const p = placeAvatar(was, now, 0.5, view, 0);
    expect(p.x).toBeCloseTo(120);
    expect(p.size).toBeGreaterThan(40);
    expect(p.ring!.rx).toBeGreaterThan(p.ring!.ry);
    expect(p.target).toEqual({ x: 400, y: 50 });
    expect(placeAvatar(undefined, createAvatar(1, 1), 1, view, 0).ring).toBeUndefined();
  });
});
