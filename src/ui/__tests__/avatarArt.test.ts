import { describe, expect, it } from 'vitest';
import { ELEMENT_LOOK } from '../../life/elements';
import { AVATAR_BODIES, avatarPalette, paintAvatar } from '../avatarArt';
import type { Paint } from '../creatureArt';

describe('the avatar’s art', () => {
  it('has a body for each form, standing on the ground', () => {
    for (const parts of Object.values(AVATAR_BODIES)) {
      expect(parts.length).toBeGreaterThan(6);
      const ys = parts.flatMap((q) => (q.e ? [q.e[1] + q.e[3]] : q.p!.filter((_, k) => k % 2)));
      expect(Math.max(...ys)).toBeCloseTo(0.32, 1);
    }
  });

  it('marks it in the colour of its gift, gold at rest', () => {
    expect(avatarPalette('rain').accent).toBe(ELEMENT_LOOK.water.colour);
    expect(avatarPalette('grow').accent).toBe(ELEMENT_LOOK.organic.colour);
    expect(avatarPalette(null).accent).toBe('#FFD23F');
  });

  it('paints every part', () => {
    let fills = 0;
    const ctx = { fillStyle: '', globalAlpha: 1, beginPath() {}, ellipse() {}, moveTo() {}, lineTo() {}, closePath() {}, fill: () => void fills++, save() {}, restore() {}, translate() {}, scale() {} } as Paint;
    paintAvatar(ctx, 'keeper', 'sun', 50, { phase: 0, facing: 1 });
    expect(fills).toBe(AVATAR_BODIES.keeper.length);
  });
});
