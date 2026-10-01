import { describe, expect, it } from 'vitest';
import type { RGB } from '../../rendering/palette';
import { BARE_ROCK_LINE, GROUND_KINDS, ROCK_LINE, foamAmount, shadeGround, type GroundKind } from '../groundShader';
import type { Amounts } from '../levels';

// Each ground kind gets a distinctive flat colour so the recipe is visible.
const FLAT: Record<GroundKind, RGB> = {
  sand: [200, 180, 120],
  wetSand: [150, 130, 90],
  sparseGrass: [170, 190, 100],
  grass: [80, 190, 60],
  forestFloor: [40, 110, 40],
  water: [60, 170, 230],
  rock: [150, 140, 130],
  snow: [245, 248, 252],
};
const texel = (k: GroundKind) => FLAT[k];
const shade = (a: Partial<Amounts>) => shadeGround({ water: 0, grass: 0, trees: 0, alt: 0, ...a }, texel);

describe('shadeGround', () => {
  it('covers every ground kind in the catalogue', () => {
    expect(Object.keys(FLAT).sort()).toEqual([...GROUND_KINDS].sort());
  });

  it('shows bare sand when nothing covers it', () => {
    expect(shade({})).toEqual(FLAT.sand);
  });

  it('shows full grass on a meadow', () => {
    expect(shade({ grass: 1 })).toEqual(FLAT.grass);
  });

  it('uses the sand/grass fuse texture between the two', () => {
    expect(shade({ grass: 0.41 })).toEqual(FLAT.sparseGrass);
  });

  it('grows grass and forest floor under dense trees', () => {
    expect(shade({ trees: 1 })).toEqual(FLAT.forestFloor);
  });

  it('turns high ground into rock, even under grass', () => {
    expect(shade({ grass: 1, alt: ROCK_LINE[1] })).toEqual(FLAT.rock);
  });

  it('covers the highest ground in snow', () => {
    expect(shade({ grass: 1, alt: 1 })).toEqual(FLAT.snow);
  });

  it('shows bare raised ground as rock rather than beach sand', () => {
    expect(shade({ alt: BARE_ROCK_LINE[1] })).toEqual(FLAT.rock);
    expect(shade({ alt: BARE_ROCK_LINE[0] - 0.01 })).toEqual(FLAT.sand);
  });

  it('keeps low ground free of rock', () => {
    expect(shade({ grass: 1, alt: ROCK_LINE[0] - 0.01 })).toEqual(FLAT.grass);
  });

  it('wets the sand just before the waterline', () => {
    expect(shade({ water: 0.37 })).toEqual(FLAT.wetSand);
  });

  it('draws foam on the waterline', () => {
    const [r, g, b] = shade({ water: 0.43 });
    expect(Math.min(r, g, b)).toBeGreaterThan(200);
  });

  it('darkens toward deep water', () => {
    const shallow = shade({ water: 0.5 });
    const deep = shade({ water: 1 });
    expect(deep[2]).toBeGreaterThan(deep[0]);
    expect(deep[0] + deep[1]).toBeLessThan(shallow[0] + shallow[1]);
  });

  it('peaks foam on the waterline and fades it away from it', () => {
    expect(foamAmount(0.43)).toBeGreaterThan(foamAmount(0.41));
    expect(foamAmount(0.3)).toBe(0);
    expect(foamAmount(0.6)).toBe(0);
  });
});
