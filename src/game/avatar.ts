import { reactive, ref } from 'vue';
import { HEX_PIXEL_SIZE } from '../config/parameters';

/**
 * Distance between two neighbouring hex centres in world pixels. Used to
 * express projectile speed and range in *hexes* (which is what a designer
 * thinks in) while the simulation runs in world pixels.
 */
export const HEX_SPACING = Math.sqrt(3) * HEX_PIXEL_SIZE;

/** Twelve firing directions, one every 30°. */
export const FIRE_DIR_COUNT = 12;
export const FIRE_DIR_STEP = (Math.PI * 2) / FIRE_DIR_COUNT;

export interface FireDir {
  /** Unit vector in world-pixel space (y down, matching the canvas). */
  x: number;
  y: number;
  angle: number;
  /** Compass label for the dev readout. */
  label: string;
  /**
   * True when this direction points straight at a neighbouring hex centre
   * — i.e. through the middle of a shared edge ("met de hex mee"). False
   * for the in-between directions, which run parallel to a hex edge and
   * (on a pointy-top hex) point straight at a corner ("langs een edge").
   */
  throughEdge: boolean;
}

const DIR_LABELS = [
  'E', 'ESE', 'SE', 'S', 'SW', 'WSW', 'W', 'WNW', 'NW', 'N', 'NE', 'ENE',
];

/**
 * The twelve directions in screen/world orientation (y down), index 0 = due
 * east, advancing clockwise in 30° steps. Even indices are the six
 * neighbour-centre directions; odd indices are the six edge-parallel ones.
 */
export const FIRE_DIRS: ReadonlyArray<FireDir> = Array.from(
  { length: FIRE_DIR_COUNT },
  (_, i) => {
    const angle = i * FIRE_DIR_STEP;
    return {
      x: Math.cos(angle),
      y: Math.sin(angle),
      angle,
      label: DIR_LABELS[i],
      throughEdge: i % 2 === 0,
    };
  },
);

/** Snap an arbitrary vector to the index of the nearest of the twelve directions. */
export function snapFireDir(dx: number, dy: number): number {
  const idx = Math.round(Math.atan2(dy, dx) / FIRE_DIR_STEP);
  return ((idx % FIRE_DIR_COUNT) + FIRE_DIR_COUNT) % FIRE_DIR_COUNT;
}

/** The player stand-in. Lives on a hex; projectiles spawn from its centre. */
export const avatar = reactive({ col: 0, row: 0 });

/** Drop the avatar on a specific hex (used by tap-to-move and world reset). */
export function placeAvatar(col: number, row: number): void {
  avatar.col = col;
  avatar.row = row;
}

/** Park the avatar in the middle of a freshly built grid. */
export function centreAvatar(width: number, height: number): void {
  placeAvatar((width / 2) | 0, (height / 2) | 0);
}

/**
 * UI state: when true, a plain drag on the map is a firing swipe instead of
 * a camera pan. Panning stays available via middle-drag or ctrl/⌘-drag.
 */
export const avatarMode = ref(true);

/**
 * A single in-flight shot. Position and velocity are in world pixels; the
 * trail is a short ring of recent positions used purely for rendering.
 */
export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Which of the twelve directions this was fired along. */
  dirIndex: number;
  /** Seconds since launch. */
  age: number;
  /** Seconds before it expires (range / speed). */
  life: number;
  trail: Array<{ x: number; y: number }>;
}

export const projectiles = reactive<Projectile[]>([]);

/** How many past positions each projectile keeps for its trail. */
const TRAIL_LENGTH = 12;

/**
 * Launch a shot from the avatar along one of the twelve directions.
 * `speedHexes` and `rangeHexes` are in hexes (and hexes/second); they're
 * converted to world pixels here so callers can stay in design units.
 */
export function fireProjectile(
  dirIndex: number,
  originX: number,
  originY: number,
  speedHexes: number,
  rangeHexes: number,
): void {
  const d = FIRE_DIRS[dirIndex];
  const speed = speedHexes * HEX_SPACING;
  projectiles.push({
    x: originX,
    y: originY,
    vx: d.x * speed,
    vy: d.y * speed,
    dirIndex,
    age: 0,
    life: speedHexes > 0 ? rangeHexes / speedHexes : 0,
    trail: [],
  });
}

/**
 * Advance every shot by dt and drop the ones that have run out of range or
 * left the map. Straight-line travel: this rig exists to judge how the
 * *controls* feel, so nothing steers the shot once it's away.
 */
export function stepProjectiles(dt: number, boundsX: number, boundsY: number): void {
  const margin = HEX_SPACING * 2;
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.trail.push({ x: p.x, y: p.y });
    if (p.trail.length > TRAIL_LENGTH) p.trail.shift();
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.age += dt;
    const gone =
      p.age >= p.life ||
      p.x < -margin ||
      p.y < -margin ||
      p.x > boundsX + margin ||
      p.y > boundsY + margin;
    if (gone) projectiles.splice(i, 1);
  }
}

export function clearProjectiles(): void {
  projectiles.splice(0, projectiles.length);
}
