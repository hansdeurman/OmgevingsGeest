import { hash2 } from '../math/noise';
import { saturation } from '../water/atmosphere';
import { LAPSE } from '../water/retention';
import { OVERCAST, type WaterCycle } from '../water/waterCycle';
import { terrainMost } from './food';
import type { Life } from './life';

/**
 * States the world can be put in at once, one button each: how warm it is,
 * how wet, how cloudy, how green. The groups stand apart from each other (a
 * cold world can be wet or dry, green or bare): a preset sets only its own
 * part of the world, on the hexes chosen (or all), each hex a little
 * different from the next. No water is made or lost: what a preset adds
 * comes from the sea, what it takes goes back there. From then on the world
 * goes its own way; a climate set for the whole world also comes with the
 * sun and greenhouse that keep it so.
 */
export type PresetGroup = 'climate' | 'water' | 'sky' | 'plants';

/** The world a preset sets: its water cycle and the life on it. */
export interface World {
  cycle: WaterCycle;
  life: Life;
}

export interface Preset {
  id: string;
  group: PresetGroup;
  name: string;
  icon: string;
  hint: string;
  /** The climate that keeps the world so, when it is set for the whole world. */
  climate?: { sun: number; greenhouse: number };
  /** Put hex `i` in this state, `wobble` (−1…1) making it a little different from the next. */
  set(w: World, i: number, wobble: number): void;
}

/** How far hexes differ from the preset, at most: degrees, share of the soil filled, of the air's humidity, of a cloud's thickness, of the plants. */
const SPREAD = { t: 2.5, fill: 0.12, humid: 0.08, cloud: 0.3, plants: 0.12 };
/** The sea freezes at this temperature; water this deep is a lake, which presets leave as it is. */
const SEA_FREEZES = -1.8;
const LAKE = 0.3;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Set `a[i]` to `v` (at least nothing), the water it takes from the sea or gives back to it. */
function viaSea(c: WaterCycle, a: Float32Array, i: number, v: number): void {
  const to = Math.max(0, v);
  c.sea -= to - a[i];
  a[i] = to;
}

/** A climate: air (at sea level) and ground this warm, on average; snow laid on the land as `snow` gives it for the air's own warmth (undefined: as it lies). */
const climate = (id: string, name: string, icon: string, hint: string, mean: number, keep: Preset['climate'], snow: (t: number) => number | undefined): Preset => ({
  id,
  group: 'climate',
  name,
  icon,
  hint,
  climate: keep,
  set({ cycle: c }, i, wobble) {
    const t = mean + SPREAD.t * wobble;
    const own = t - LAPSE * c.heat.height[i];
    c.heat.air[i] = t;
    c.temperature[i] = own;
    c.heat.surface[i] = c.air.sea[i] ? Math.max(SEA_FREEZES, t) : own;
    const lies = c.air.sea[i] ? undefined : snow(own);
    if (lies !== undefined) viaSea(c, c.world.snow, i, lies * (1 + 0.3 * wobble));
  },
});

/** Wetness: soil this full, this much water standing in hollows (lakes stay), air this humid. */
const water = (id: string, name: string, icon: string, hint: string, fill: number, standing: number, humidity: number): Preset => ({
  id,
  group: 'water',
  name,
  icon,
  hint,
  set({ cycle: c }, i, wobble) {
    const { world, air } = c;
    if (!air.sea[i]) {
      viaSea(c, world.soil, i, clamp01(fill + SPREAD.fill * wobble) * world.soak.capacity[i]);
      if (world.depth[i] < LAKE) viaSea(c, world.depth, i, standing * (1 + 0.5 * wobble));
    }
    viaSea(c, air.vapour, i, clamp01(humidity + SPREAD.humid * wobble) * saturation(c.temperature[i]));
  },
});

/** The sky: clouds this thick over air this humid. */
const sky = (id: string, name: string, icon: string, hint: string, cloud: number, humidity: number): Preset => ({
  id,
  group: 'sky',
  name,
  icon,
  hint,
  set({ cycle: c }, i, wobble) {
    viaSea(c, c.air.cloud, i, cloud * (1 + SPREAD.cloud * wobble));
    viaSea(c, c.air.vapour, i, clamp01(humidity + SPREAD.humid * wobble) * saturation(c.temperature[i]));
  },
});

/** Plants: this share of what the land grows, on the land as it was painted, or greened as far as it gets. */
const plants = (id: string, name: string, icon: string, hint: string, share: number, greened: boolean): Preset => ({
  id,
  group: 'plants',
  name,
  icon,
  hint,
  set({ cycle: c, life }, i, wobble) {
    const { food } = life;
    if (c.air.sea[i]) return;
    food.room[i] = greened ? Math.max(food.base[i], terrainMost(c.heat.height[i])) : food.base[i];
    food.plants[i] = clamp01(share + SPREAD.plants * wobble) * food.room[i];
  },
});

const below = (t: number, deep: number) => (own: number) => (own < t ? deep : 0);

export const PRESETS: readonly Preset[] = [
  climate('frozen', 'Frozen', '🧊', 'An ice age: deep frost, snow over the land, the sea freezing', -12, { sun: 1.6, greenhouse: 0.3 }, () => 0.25),
  climate('cold', 'Cold', '❄️', 'Long cold winters: snow wherever it freezes', -2, { sun: 2.2, greenhouse: 0.3 }, below(0, 0.08)),
  climate('mild', 'Mild', '🌤', 'The world as it was made: cool, with short frosts', 5.5, { sun: 2.65, greenhouse: 0.3 }, () => undefined),
  climate('warm', 'Warm', '☀️', 'Warm summers, mild winters, the snow gone', 11, { sun: 2.9, greenhouse: 0.36 }, () => 0),
  climate('hot', 'Hot', '🔥', 'Hot: scorching summers, no frost at all', 15, { sun: 3, greenhouse: 0.42 }, () => 0),
  water('parched', 'Parched', '🏜', 'Bone dry ground and dry air; lakes stay', 0.02, 0, 0.35),
  water('dry', 'Dry', '🌾', 'Dry ground, dry air', 0.2, 0, 0.5),
  water('moist', 'Normal', '🌱', 'Ground as moist as usual', 0.55, 0, 0.75),
  water('wet', 'Wet', '💧', 'Soaked ground, puddles, humid air', 0.95, 0.03, 0.9),
  water('flooded', 'Flooded', '🌊', 'Water standing everywhere, running off in floods', 1, 0.35, 0.95),
  sky('clear', 'Clear', '🌞', 'Not a cloud in the sky, and drier air', 0, 0.6),
  sky('cloudy', 'Cloudy', '☁️', 'An overcast sky', OVERCAST * 1.2, 1),
  sky('storm', 'Storm', '⛈', 'Heavy clouds that rain hard', 0.3, 1),
  plants('barren', 'Barren', '🟫', 'Grazed or burnt bare: nothing growing', 0.03, false),
  plants('meadow', 'Meadow', '🌿', 'Everything grown as full as the land was painted', 1, false),
  plants('lush', 'Lush', '🌳', 'Green as far as the land can grow, sand and all', 1, true),
];

export const PRESET_GROUPS: readonly { id: PresetGroup; name: string }[] = [
  { id: 'climate', name: 'Climate' },
  { id: 'water', name: 'Water' },
  { id: 'sky', name: 'Sky' },
  { id: 'plants', name: 'Plants' },
];

const BY_ID = new Map(PRESETS.map((p) => [p.id, p]));
export const presetOf = (id: string) => BY_ID.get(id);

/** How hex `i` differs from a preset set with `seed`: −1…1. */
export const wobbleOf = (i: number, seed: number) => 2 * hash2(i, 7, seed) - 1;

/** Put the hexes `cells` (all, if not given) of the world in the state preset `id` stands for. */
export function applyPreset(w: World, id: string, cells: readonly number[] | undefined, seed: number): void {
  const p = presetOf(id);
  if (!p) return;
  const each = (i: number) => p.set(w, i, wobbleOf(i, seed));
  if (cells) cells.forEach(each);
  else for (let i = 0; i < w.cycle.air.sea.length; i++) each(i);
}
