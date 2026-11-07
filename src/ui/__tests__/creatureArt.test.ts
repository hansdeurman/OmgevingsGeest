import { describe, expect, it } from 'vitest';
import { BESTIARY, kindOf } from '../../life/bestiary';
import { ELEMENT_LOOK } from '../../life/elements';
import { BODIES, mixColour, paintCreature, paletteOf, type Paint } from '../creatureArt';

/** A stand-in canvas that keeps what is drawn on it. */
function recorder() {
  const fills: { style: string; ry?: number }[] = [];
  const scales: [number, number][] = [];
  let ry: number | undefined;
  const ctx: Paint = {
    fillStyle: '',
    globalAlpha: 1,
    beginPath: () => (ry = undefined),
    ellipse: (_x, _y, _rx, r) => void (ry = r),
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    fill: () => void fills.push({ style: ctx.fillStyle as string, ry }),
    save: () => {},
    restore: () => {},
    translate: () => {},
    scale: (x, y) => void scales.push([x, y]),
  };
  return { ctx, fills, scales };
}

describe('BODIES', () => {
  it('gives every creature a body of several parts, within its box, with something to see by', () => {
    for (const s of BESTIARY) {
      const parts = BODIES[s.body];
      expect(parts.length, s.body).toBeGreaterThanOrEqual(5);
      for (const q of parts) {
        const xs = q.e ? [q.e[0] - q.e[2], q.e[0] + q.e[2]] : q.p!.filter((_, k) => k % 2 === 0);
        const ys = q.e ? [q.e[1] - q.e[3], q.e[1] + q.e[3]] : q.p!.filter((_, k) => k % 2 === 1);
        xs.forEach((x) => expect(Math.abs(x), s.body).toBeLessThanOrEqual(0.72));
        ys.forEach((y) => expect(y, s.body).toBeGreaterThanOrEqual(-0.65));
        ys.forEach((y) => expect(y, s.body).toBeLessThanOrEqual(0.36));
      }
      expect(parts.some((q) => q.eye || q.fill === 'accent'), s.body).toBe(true);
    }
  });
});

describe('paletteOf', () => {
  it('colours a creature by its first element, its marks by its second', () => {
    const eel = paletteOf(BESTIARY[kindOf('stormeel')]);
    expect(eel.main).toBe(ELEMENT_LOOK.water.colour);
    expect(eel.accent).toBe(ELEMENT_LOOK.electric.colour);
    const hare = paletteOf(BESTIARY[kindOf('hare')]);
    expect(hare.accent).toBe(ELEMENT_LOOK.organic.shade);
    expect(hare.light).toBe(mixColour(hare.main, '#FFFFFF', 0.5));
  });

  it('mixes colours', () => {
    expect(mixColour('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mixColour('#FF0000', '#0000FF', 0)).toBe('#FF0000');
  });
});

describe('paintCreature', () => {
  const owl = BESTIARY[kindOf('dreamowl')];

  it('fills each part of its body once, in its colours, at its size, facing its way', () => {
    const { ctx, fills, scales } = recorder();
    paintCreature(ctx, owl, 40, { phase: 0, facing: -1 });
    expect(fills).toHaveLength(BODIES.owl.length);
    expect(new Set(fills.map((f) => f.style))).toContain(paletteOf(owl).main);
    expect(scales[0]).toEqual([-40, 40]);
  });

  it('shuts its eyes asleep, and flaps its wings as the phase goes round', () => {
    const awake = recorder();
    paintCreature(awake.ctx, owl, 40, { phase: 0.25, facing: 1 });
    const asleep = recorder();
    paintCreature(asleep.ctx, owl, 40, { phase: 0.25, facing: 1, asleep: true });
    expect(asleep.fills.length).toBe(awake.fills.length - 2);
    const later = recorder();
    paintCreature(later.ctx, owl, 40, { phase: 0.75, facing: 1 });
    expect(later.fills[0].ry).not.toBeCloseTo(awake.fills[0].ry!);
  });
});
