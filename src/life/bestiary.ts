import type { Element, PowerKind, Quality } from './elements';

/**
 * Every kind of creature there is. Ordinary ones live off the land, breed
 * in their season and die; each has a small power, bent to its element.
 * Mystic ones are not born: the world calls them when it tips too far one
 * way (a drought, a deep frost, a land grazed bare), they work their great
 * powers where the need is, and fade when it has passed. Time in steps (a
 * year is 640), distance in hex spacings, temperatures in °C, energy as a
 * share of what a creature can hold.
 */

/** How it gets about: on land (walking, or climbing mountains as easily), on land and in shallow water, only in water, or through the air, carried by the wind. */
export type Moves = 'walk' | 'climb' | 'wade' | 'swim' | 'fly';

/** The shape it is drawn as. */
export type Body = 'moth' | 'bird' | 'owl' | 'hare' | 'goat' | 'fox' | 'kitsune' | 'otter' | 'lizard' | 'frog' | 'fish' | 'serpent' | 'whale' | 'golem' | 'wisp' | 'deer' | 'lion' | 'dragon' | 'tortoise';

export interface Power {
  kind: PowerKind;
  /** How strong, in the power's own measure (see `powers`). */
  strength: number;
  /** Hexes around it it reaches. */
  reach: number;
  /** Mind powers: whom it works on, its prey or a kind about to vanish (everyone else, if not given). */
  on?: 'prey' | 'few';
}

/** Energy it gets per step from each food, where the food is plentiful. */
export interface Diet {
  plants?: number;
  fish?: number;
  /** From the qualities its elements draw on (or `on`), at their fullest. */
  elements?: number;
  on?: readonly Quality[];
  prey?: readonly string[];
}

/** What calls a mystic creature: the world tipped too far. */
export type Need = 'gloom' | 'drought' | 'barren' | 'frost' | 'gale' | 'storm' | 'stifling' | 'vanishing';

export interface Species {
  id: string;
  name: string;
  types: readonly Element[];
  mystic: boolean;
  moves: Moves;
  body: Body;
  /** Across (hex spacings): how it is drawn, how much it eats, how much it is worth eating. */
  size: number;
  speed: number;
  comfort: readonly [number, number];
  /** Sleeps through the cold rather than suffer it; or flies off for the winter, back in spring. */
  sleeps?: boolean;
  migrates?: boolean;
  diet: Diet;
  burn: number;
  lifespan: number;
  matures: number;
  /** Broods a year, while it is spring or summer; young per brood. */
  broods: number;
  brood: number;
  /** Keeps to its own kind: a herd, a flock, a swarm. */
  herds?: boolean;
  /** How many there are when a run starts. */
  start: number;
  powers: readonly Power[];
  answers?: Need;
  lore: string;
}

const ordinary = (s: Omit<Species, 'mystic'>): Species => ({ ...s, mystic: false });
const mystic = (s: Omit<Species, 'mystic' | 'diet' | 'burn' | 'matures' | 'broods' | 'brood' | 'start' | 'comfort'> & { answers: Need }): Species => ({
  ...s,
  mystic: true,
  diet: {},
  burn: 0,
  comfort: [-60, 60],
  matures: Infinity,
  broods: 0,
  brood: 0,
  start: 0,
});

/** One element each: an ordinary creature and a mystic one of every element. */
const SINGLE: readonly Species[] = [
  ordinary({ id: 'glowmoth', name: 'Glowmoth', types: ['light'], moves: 'fly', body: 'moth', size: 0.14, speed: 0.12, comfort: [6, 32], sleeps: true, diet: { elements: 0.012, plants: 0.006 }, burn: 0.006, lifespan: 900, matures: 70, broods: 3, brood: 4, herds: true, start: 24, powers: [{ kind: 'shine', strength: 0.15, reach: 0 }], lore: 'Drinks sunlight by day and glows by night; where it flutters, flowers open.' }),
  ordinary({ id: 'otter', name: 'River Otter', types: ['water'], moves: 'wade', body: 'otter', size: 0.35, speed: 0.18, comfort: [-8, 28], diet: { fish: 0.03 }, burn: 0.005, lifespan: 2400, matures: 320, broods: 1, brood: 2, start: 4, powers: [{ kind: 'mist', strength: 0.0004, reach: 0 }], lore: 'Fishes the rivers and lakes; its splashing hangs a little mist in the air.' }),
  ordinary({ id: 'hare', name: 'Meadow Hare', types: ['organic'], moves: 'walk', body: 'hare', size: 0.3, speed: 0.2, comfort: [-12, 28], diet: { plants: 0.03 }, burn: 0.005, lifespan: 1300, matures: 150, broods: 3, brood: 4, herds: true, start: 16, powers: [{ kind: 'grow', strength: 0.3, reach: 0 }], lore: 'Grazes the meadows and sows them again as it goes.' }),
  ordinary({ id: 'salamander', name: 'Ember Salamander', types: ['fire'], moves: 'walk', body: 'lizard', size: 0.25, speed: 0.08, comfort: [4, 42], sleeps: true, diet: { elements: 0.016, prey: ['glowmoth'] }, burn: 0.005, lifespan: 2000, matures: 320, broods: 1, brood: 2, start: 4, powers: [{ kind: 'warm', strength: 0.08, reach: 0 }], lore: 'Basks in the warmest hollows and keeps them warm; sleeps the winter away.' }),
  ordinary({ id: 'goat', name: 'Rock Goat', types: ['stone'], moves: 'climb', body: 'goat', size: 0.4, speed: 0.15, comfort: [-25, 20], diet: { plants: 0.025, elements: 0.006 }, burn: 0.004, lifespan: 3000, matures: 400, broods: 1, brood: 1, herds: true, start: 6, powers: [{ kind: 'shelter', strength: 0.04, reach: 0 }], lore: 'Climbs where nothing else can; its flock huddles out of the wind.' }),
  ordinary({ id: 'sparkfox', name: 'Spark Fox', types: ['electric'], moves: 'walk', body: 'fox', size: 0.4, speed: 0.3, comfort: [-15, 30], diet: { prey: ['hare', 'glowmoth'], elements: 0.003 }, burn: 0.005, lifespan: 2500, matures: 400, broods: 1, brood: 3, start: 4, powers: [{ kind: 'spark', strength: 0.03, reach: 0 }], lore: 'Hunts hares; the static in its fur crackles in storms and shakes the rain loose.' }),
  ordinary({ id: 'swallow', name: 'Gale Swallow', types: ['wind'], moves: 'fly', body: 'bird', size: 0.22, speed: 0.4, comfort: [4, 32], migrates: true, diet: { elements: 0.012, prey: ['glowmoth'] }, burn: 0.007, lifespan: 1500, matures: 200, broods: 1, brood: 3, herds: true, start: 8, powers: [{ kind: 'gust', strength: 0.004, reach: 0 }], lore: 'Rides the wind, catching what it carries; a flock leaves a gust behind. Flies south for the winter.' }),
  ordinary({ id: 'dreamowl', name: 'Dream Owl', types: ['psychic'], moves: 'fly', body: 'owl', size: 0.4, speed: 0.3, comfort: [-20, 28], diet: { prey: ['hare', 'glowmoth'], elements: 0.003 }, burn: 0.005, lifespan: 3000, matures: 450, broods: 1, brood: 2, start: 2, powers: [{ kind: 'lure', strength: 1, reach: 2, on: 'prey' }], lore: 'Its eyes draw small creatures near; they come as if dreaming.' }),

  mystic({ id: 'sunmane', name: 'Sunmane', types: ['light'], moves: 'walk', body: 'lion', size: 0.9, speed: 0.2, lifespan: 900, answers: 'gloom', powers: [{ kind: 'shine', strength: 0.6, reach: 3 }, { kind: 'warm', strength: 0.3, reach: 2 }], lore: 'Comes when grey skies hang too long; its mane burns the clouds away and the meadows bloom.' }),
  mystic({ id: 'raindragon', name: 'Rain Dragon', types: ['water'], moves: 'fly', body: 'dragon', size: 1.2, speed: 0.3, lifespan: 900, answers: 'drought', powers: [{ kind: 'mist', strength: 0.01, reach: 3 }, { kind: 'rain', strength: 0.3, reach: 2 }], lore: 'Rises from the last lake when the land thirsts, and pulls the rain behind it.' }),
  mystic({ id: 'mossback', name: 'Mossback', types: ['organic'], moves: 'walk', body: 'tortoise', size: 1.3, speed: 0.05, lifespan: 1300, answers: 'barren', powers: [{ kind: 'grow', strength: 4, reach: 3 }, { kind: 'shelter', strength: 0.3, reach: 2 }], lore: 'An old tortoise with a forest on its back; where it walks, bare land turns green.' }),
  mystic({ id: 'phoenix', name: 'Phoenix', types: ['fire'], moves: 'fly', body: 'bird', size: 1, speed: 0.35, lifespan: 700, answers: 'frost', powers: [{ kind: 'warm', strength: 0.8, reach: 3 }], lore: 'Flares up in the deepest frost and thaws the world around it.' }),
  mystic({ id: 'golem', name: 'Boulder Golem', types: ['stone'], moves: 'climb', body: 'golem', size: 1.2, speed: 0.06, lifespan: 1000, answers: 'gale', powers: [{ kind: 'shelter', strength: 0.7, reach: 3 }], lore: 'Stands up from the mountain when the gales rage, and the wind breaks on it.' }),
  mystic({ id: 'raiju', name: 'Raiju', types: ['electric'], moves: 'fly', body: 'fox', size: 0.9, speed: 0.45, lifespan: 500, answers: 'storm', powers: [{ kind: 'spark', strength: 0.4, reach: 2 }, { kind: 'gust', strength: 0.03, reach: 2 }], lore: 'Rides the great storms as lightning; where it strikes the storm spends itself and the ground grows rich.' }),
  mystic({ id: 'skyserpent', name: 'Sky Serpent', types: ['wind'], moves: 'fly', body: 'serpent', size: 1.5, speed: 0.4, lifespan: 800, answers: 'stifling', powers: [{ kind: 'gust', strength: 0.08, reach: 3 }, { kind: 'chill', strength: 0.4, reach: 2 }], lore: 'Uncoils over still, sweltering land and stirs a cool wind.' }),
  mystic({ id: 'kitsune', name: 'Spirit Kitsune', types: ['psychic'], moves: 'walk', body: 'kitsune', size: 0.8, speed: 0.25, lifespan: 1200, answers: 'vanishing', powers: [{ kind: 'calm', strength: 1, reach: 3 }, { kind: 'lure', strength: 2, reach: 6, on: 'few' }], lore: 'Comes to the last of a kind: it gathers them and keeps the hunters away.' }),
];

/** Two elements each: blends that make sense in the world. The first is the creature's colour, the second its marks. */
const DUAL: readonly Species[] = [
  ordinary({ id: 'swampfrog', name: 'Swamp Frog', types: ['organic', 'water'], moves: 'wade', body: 'frog', size: 0.2, speed: 0.1, comfort: [5, 32], sleeps: true, diet: { prey: ['glowmoth'], elements: 0.008, on: ['wet'] }, burn: 0.005, lifespan: 1200, matures: 160, broods: 1, brood: 4, herds: true, start: 6, powers: [{ kind: 'rain', strength: 0.02, reach: 0 }], lore: 'Sings for rain in the reeds, and a little falls.' }),
  ordinary({ id: 'stormeel', name: 'Storm Eel', types: ['water', 'electric'], moves: 'swim', body: 'fish', size: 0.4, speed: 0.2, comfort: [0, 30], diet: { fish: 0.03 }, burn: 0.005, lifespan: 2500, matures: 400, broods: 1, brood: 2, start: 3, powers: [{ kind: 'spark', strength: 0.05, reach: 1 }], lore: 'Stuns fish with a jolt; in a storm its sparks bring the rain down.' }),
  ordinary({ id: 'cinderram', name: 'Cinder Ram', types: ['stone', 'fire'], moves: 'climb', body: 'goat', size: 0.5, speed: 0.15, comfort: [-20, 35], diet: { plants: 0.025, elements: 0.007 }, burn: 0.005, lifespan: 3000, matures: 450, broods: 1, brood: 1, start: 3, powers: [{ kind: 'warm', strength: 0.15, reach: 1 }, { kind: 'shelter', strength: 0.05, reach: 0 }], lore: 'Its glowing horns melt the snow off the high pastures, and spring comes early where it grazes.' }),
  ordinary({ id: 'wisp', name: 'Will-o’-Wisp', types: ['light', 'psychic'], moves: 'fly', body: 'wisp', size: 0.2, speed: 0.12, comfort: [-5, 28], diet: { elements: 0.01 }, burn: 0.006, lifespan: 1500, matures: 200, broods: 1, brood: 2, start: 3, powers: [{ kind: 'lure', strength: 1.2, reach: 2 }, { kind: 'shine', strength: 0.1, reach: 1 }], lore: 'A drifting light over the marsh that lures the curious after it.' }),
  ordinary({ id: 'cloudwhale', name: 'Cloud Whale', types: ['wind', 'water'], moves: 'fly', body: 'whale', size: 1.1, speed: 0.08, comfort: [-15, 25], diet: { elements: 0.01, on: ['cloud'] }, burn: 0.003, lifespan: 6000, matures: 1200, broods: 1, brood: 1, herds: true, start: 2, powers: [{ kind: 'mist', strength: 0.002, reach: 2 }], lore: 'Grazes the clouds, carried by the wind; where it swims, clouds gather.' }),
  ordinary({ id: 'sunstag', name: 'Sun Stag', types: ['light', 'organic'], moves: 'walk', body: 'deer', size: 0.6, speed: 0.18, comfort: [-10, 28], diet: { plants: 0.025, elements: 0.004 }, burn: 0.004, lifespan: 4000, matures: 640, broods: 1, brood: 1, start: 2, powers: [{ kind: 'grow', strength: 1, reach: 2 }, { kind: 'shine', strength: 0.08, reach: 1 }], lore: 'Rare and golden; the forest grows thick where it wanders.' }),
];

export const BESTIARY: readonly Species[] = [...SINGLE, ...DUAL];

const INDEX = new Map(BESTIARY.map((s, k) => [s.id, k]));

/** The bestiary's index of a kind of creature. */
export const kindOf = (id: string): number => {
  const k = INDEX.get(id);
  if (k === undefined) throw new Error(`No creature '${id}'`);
  return k;
};

const PREY = new Map<Species, readonly number[]>();

/** The kinds a kind hunts, by index. */
export function preyOf(s: Species): readonly number[] {
  let prey = PREY.get(s);
  if (!prey) PREY.set(s, (prey = (s.diet.prey ?? []).map(kindOf)));
  return prey;
}
