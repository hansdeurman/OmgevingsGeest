import { ELEMENT_LOOK } from '../life/elements';
import { GIFTS, type Form, type Gift } from '../player/avatar';
import { arc, beast, E, eye, mixColour, P, paintParts, type Paint, type Palette, type Part, type Pose } from './creatureArt';

/**
 * The player's avatar, drawn as the creatures are, flat and bright: as a
 * spirit beast (a pale stag-wolf with glowing marks), or as a keeper (a
 * cloaked figure with a staff). Its marks, the staff's light, take the
 * colour of the gift it works; at rest they are gold.
 */
export const AVATAR_BODIES: Record<Form, readonly Part[]> = {
  beast: beast({
    body: [0.3, 0.15],
    head: [0.31, -0.14, 0.12],
    legs: 0.2,
    tail: [E('main', -0.38, -0.08, 0.2, 0.07, -0.35), E('accent', -0.52, -0.14, 0.07, 0.045, -0.35)],
    over: [E('accent', -0.1, -0.04, 0.05, 0.03), E('accent', 0.04, -0.07, 0.04, 0.025), E('main', 0.22, -0.08, 0.07, 0.12, 0.5)],
    ears: [arc('accent', 0.22, -0.34, 0.1, 0.4, -2.2, 0.03), arc('accent', 0.36, -0.34, 0.1, 2.7, 0.9, 0.03), P('main', 0.26, -0.22, 0.28, -0.32, 0.33, -0.22)],
  }),
  keeper: [
    E('shade', -0.02, 0.29, 0.2, 0.03),
    P('main', -0.18, 0.3, -0.06, -0.3, 0.08, -0.3, 0.2, 0.3),
    P('shade', -0.02, 0.3, 0.02, -0.2, 0.06, 0.3),
    P('dark', 0.26, 0.3, 0.29, -0.52, 0.31, -0.52, 0.29, 0.3),
    E('accent', 0.3, -0.56, 0.06, 0.06),
    E('main', 0.15, -0.12, 0.13, 0.04, 0.4),
    E('light', 0.0, -0.38, 0.1, 0.11),
    P('main', -0.13, -0.33, 0.0, -0.56, 0.13, -0.33, 0.07, -0.44, -0.07, -0.44),
    ...eye(0.04, -0.38, 0.03),
    E('accent', -0.06, -0.06, 0.04, 0.04),
  ],
};

/** The avatar's colours: pale, its marks gold, or the colour of the gift it works. */
export function avatarPalette(gift: Gift | null): Palette {
  const accent = gift ? ELEMENT_LOOK[GIFTS[gift].element].colour : '#FFD23F';
  return { main: '#EEF0FF', shade: '#A99CF2', accent, light: mixColour('#FFE3C8', '#FFFFFF', 0.2), white: '#FFFFFF', dark: '#3A2E6E' };
}

export const paintAvatar = (ctx: Paint, form: Form, gift: Gift | null, size: number, pose: Pose) => paintParts(ctx, AVATAR_BODIES[form], avatarPalette(gift), size, pose);
