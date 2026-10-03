/** Hex radius (px) on large screens, and on small ones: there the map is shown at about half size, so painting it smaller costs far less and loses nothing. */
const LARGE = 40;
const SMALL = 24;
/** A screen whose shorter side is under this many CSS px is small (a phone). */
const SMALL_SCREEN = 700;
const BOUNDS = [16, 48] as const;

/** The hex radius to paint the map at on this screen; `?hex=N` in `search` asks for one. */
export function hexSizeFor(screen: { width: number; height: number }, search = ''): number {
  const asked = Number(new URLSearchParams(search).get('hex'));
  if (asked) return Math.min(BOUNDS[1], Math.max(BOUNDS[0], Math.round(asked)));
  return Math.min(screen.width, screen.height) < SMALL_SCREEN ? SMALL : LARGE;
}
