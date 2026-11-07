/**
 * The eight elements a creature can be of, what in the world each draws on,
 * the powers each can work on the world, and which elements get the better
 * of which. A creature has one element, or a blend of two or more.
 */
export const ELEMENTS = ['light', 'water', 'organic', 'fire', 'stone', 'electric', 'wind', 'psychic'] as const;
export type Element = (typeof ELEMENTS)[number];

/** Flat, bright colours (a main colour and a deeper shade) for each element, and a one-glyph mark. */
export const ELEMENT_LOOK: Record<Element, { colour: string; shade: string; mark: string }> = {
  light: { colour: '#FFD23F', shade: '#F5A623', mark: '☀' },
  water: { colour: '#2EA8FF', shade: '#1D6FD8', mark: '💧' },
  organic: { colour: '#3DDC84', shade: '#1E9E5A', mark: '🌿' },
  fire: { colour: '#FF5A36', shade: '#D7263D', mark: '🔥' },
  stone: { colour: '#B39B85', shade: '#7D6B5D', mark: '⛰' },
  electric: { colour: '#7DF9FF', shade: '#2BD9E8', mark: '⚡' },
  wind: { colour: '#C6F7E9', shade: '#7FD8BE', mark: '🌀' },
  psychic: { colour: '#C77DFF', shade: '#8E44D9', mark: '👁' },
};

/** What the world offers that a creature can feel, each 0–1 on a hex: see `habitat`. */
export const QUALITIES = ['sun', 'wet', 'green', 'warm', 'cold', 'high', 'storm', 'wind', 'cloud', 'minds'] as const;
export type Quality = (typeof QUALITIES)[number];

/** The quality each element draws its strength from: creatures of it are at home, and some feed on it. */
export const DRAWS_ON: Record<Element, Quality> = {
  light: 'sun',
  water: 'wet',
  organic: 'green',
  fire: 'warm',
  stone: 'high',
  electric: 'storm',
  wind: 'wind',
  psychic: 'minds',
};

/** The families of powers, and the powers in each: what a creature can do to the world around it. */
export const POWER_FAMILIES = {
  thermal: ['warm', 'chill'],
  kinetic: ['gust', 'shelter'],
  radiant: ['shine', 'spark'],
  hydro: ['mist', 'rain', 'freeze'],
  growth: ['grow'],
  mind: ['lure', 'scare', 'calm'],
} as const;
export type PowerFamily = keyof typeof POWER_FAMILIES;
export type PowerKind = (typeof POWER_FAMILIES)[PowerFamily][number];

export const POWER_KINDS = Object.values(POWER_FAMILIES).flat() as PowerKind[];

export const familyOf = (kind: PowerKind): PowerFamily => (Object.keys(POWER_FAMILIES) as PowerFamily[]).find((f) => (POWER_FAMILIES[f] as readonly string[]).includes(kind))!;

/** What each power does, for the player. */
export const POWER_HINT: Record<PowerKind, string> = {
  warm: 'warms the air and ground, melting snow',
  chill: 'cools the air and ground',
  gust: 'drives the wind the way it goes',
  shelter: 'stills the wind around it',
  shine: 'thins the clouds and makes plants grow',
  spark: 'strikes heavy clouds into rain; the ground grows rich',
  mist: 'lifts water into the air: more clouds',
  rain: 'makes the clouds above it rain',
  freeze: 'freezes standing water into ice',
  grow: 'makes plants grow faster',
  lure: 'draws other creatures to it',
  scare: 'drives other creatures away',
  calm: 'no creature hunts near it',
};

/** The powers creatures of each element can have. */
export const POWERS_OF: Record<Element, readonly PowerKind[]> = {
  light: ['shine', 'warm'],
  water: ['mist', 'rain', 'freeze', 'chill'],
  organic: ['grow', 'shelter'],
  fire: ['warm'],
  stone: ['shelter'],
  electric: ['spark', 'gust'],
  wind: ['gust', 'chill'],
  psychic: ['lure', 'scare', 'calm'],
};

/** Which elements each gets the better of, and why. */
export const BEATS: Record<Element, readonly Element[]> = {
  water: ['fire', 'stone'], // douses flame, wears rock away
  fire: ['organic', 'wind'], // burns plants, eats the air
  organic: ['water', 'stone'], // drinks it, roots crack rock
  stone: ['electric', 'fire'], // grounds lightning, smothers flame
  electric: ['water', 'wind'], // runs through water, rides the storm
  wind: ['organic', 'light'], // bends plants, blows clouds over the sun
  light: ['psychic', 'water'], // shows illusions for what they are, dries water up
  psychic: ['stone', 'electric'], // moves mountains, calms the storm
};

/** How much better (above 1) or worse (below 1) one element fares against another. */
export const EDGE = 1.5;
export const edgeOf = (a: Element, b: Element) => (BEATS[a].includes(b) ? EDGE : BEATS[b].includes(a) ? 1 / EDGE : 1);

/** How a creature of `attacker`'s elements fares against one of `defender`'s: its best element, against all of the other's. */
export const matchup = (attacker: readonly Element[], defender: readonly Element[]) =>
  Math.max(...attacker.map((a) => defender.reduce((m, d) => m * edgeOf(a, d), 1)));
