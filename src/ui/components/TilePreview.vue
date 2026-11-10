<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { DEMO_MAPS, demoMap, floodedGrid, type DemoMap, type MapLabel } from '../../tiles/demoMaps';
import { ART_HEX, frameCentre, gridFrame } from '../../tiles/geometry';
import { IsoRenderer, fitTransform, projectToScreen, type ViewTransform, type WallImages } from '../../tiles/IsoRenderer';
import { loadSprites } from '../../tiles/imageSprites';
import { createPlaceholderSprites, type SpriteSet } from '../../tiles/placeholderSprites';
import { TEXTURE_FILES, loadCliff, loadGroundTextures, loadLakeKit, loadPoolFace, loadWalls, textureSize } from '../../tiles/imageTextures';
import { lakeWeather, type LakeKit } from '../../tiles/highLakes';
import type { Raster } from '../../tiles/raster';
import type { MountainStyle } from '../../tiles/relief';
import { createPlaceholderTextures, type GroundTextures } from '../../tiles/placeholderTextures';
import { buildScene, paintLakes, tileAt, type LakeOptions, type Scene } from '../../tiles/scene';
import { groundCoverOf, hydroWorldOf, plantRoomOf } from '../../tiles/mapHydro';
import type { HexTopology } from '../../water/hexTopology';
import { createRun, type Run } from '../../water/waterRun';
import { seasonOf, YEAR } from '../../water/sun';
import { createWaterCycle, defaultClimate } from '../../water/waterCycle';
import { command, createEcosystem, ecoModel, forgetCommands, type Command, type EcoSnapshot, type Ecosystem, type LifeSnapshot } from '../../life/ecosystem';
import { FORMS, GIFT_ORDER, GIFTS, type Avatar, type Form, type Gift } from '../../player/avatar';
import { ELEMENT_LOOK } from '../../life/elements';
import { mapToFrame, screenToMap } from '../mapView';
import { seasonLook, type SeasonLook } from '../seasonLook';
import { hexReadout } from '../hexReadout';
import { cameraTransform, ease, pan, zoomBy, type Camera } from '../camera';
import { hexAt } from '../../life/hexSpace';
import { creatureAt, CreatureSprites, drawAvatar, drawCreatures, placeAvatar, placeCreatures, type Placed } from '../creatureLayer';
import { callRows, describe, kindRows, loreOf, RELEASABLE } from '../lifePanel';
import { CLIMATE_SETTINGS, climateReadout, setValue, valueOf, type ClimateSetting } from '../climateSettings';
import { drawWind, windArrows } from '../windOverlay';
import { createDeck, deckMap, type CloudDeck, type SkyField } from '../../clouds/cloudDeck';
import { CloudGL, type SkyLook } from '../../clouds/cloudGL';
import { cloudAtlas } from '../../clouds/cloudSprites';
import { timed } from '../perf';
import { hexSizeFor } from '../display';
import { asyncLakes, type LakeReply } from '../../tiles/lakeSource';
import { LAKE_SETTLES } from '../../tiles/scene';
import { GroundGL } from '../../tiles/gl/groundGL';
import { workerPainters } from '../../tiles/basePool';

/** Hex radius: the map is painted at about the size it is shown at, far smaller on a phone. */
const HEX = hexSizeFor(window.screen, window.location.search);
const SQUASH = 0.65;
const MAX_DPR = 2;
const THICKNESS = 0.26 * HEX;

const host = ref<HTMLDivElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
/** Under the canvas: the flat map's ground, graded by the water on the GPU (unless ?gpu=0, or there is no WebGL2). */
const groundCanvas = ref<HTMLCanvasElement | null>(null);
let groundGl: GroundGL | undefined;
/** The map played on: the highlands, a whole world, unless another is picked. */
const mapId = ref(DEMO_MAPS.find((m) => m.id === 'highlands')?.id ?? DEMO_MAPS[0].id);
const seed = ref(1);
const blend = ref(0.6);
const showGrid = ref(false);
const contours = ref(false);
const useArt = ref(true);
/** Height of the highest ground, as a percentage of one hex row's offset. */
const relief = ref(100);
const mountainStyle = ref<MountainStyle>('sprites');
/** High lakes: the season (-100 winter … 100 summer) and the wind. */
const season = ref(0);
const wind = ref(25);
const windDir = ref(30);
const HEX_ROW = 1.5 * HEX * SQUASH;

const placeholders = createPlaceholderTextures(textureSize(HEX, 128));
let art: Partial<GroundTextures> = {};
const placeholderSprites = createPlaceholderSprites(HEX);
let artSprites: Partial<SpriteSet> = {};
let artWalls: WallImages = {};
let artCliff: Raster | undefined;
let artPoolFace: Raster | undefined;
let artLakes: LakeKit | undefined;
const renderer = new IsoRenderer(placeholderSprites);
let scene: Scene | null = null;
let labels: MapLabel[] = [];
let resizeObs: ResizeObserver | null = null;
let map: DemoMap = demoMap(mapId.value, seed.value);

/**
 * The current map's water cycle, run on as it plays: the climate makes the
 * weather, the air brings rain and snow to the mountains, the rivers run.
 * Its clouds drift on as puffs between the model's steps.
 */
let run: { water: Run<EcoSnapshot>; eco: Ecosystem; topo: HexTopology; ground: Float32Array; deck: CloudDeck; map: DemoMap; lakes: number[] } | null = null;
/** The climate's settings, which the run reads as it goes, and the sliders' copy of them. */
const params = defaultClimate();
const settings = ref(CLIMATE_SETTINGS.map((s) => valueOf(params, s)));
const step = ref(0);
/** The furthest step run so far, and the earliest it can still go back to. */
const steps = ref(0);
const firstStep = ref(0);
/** Counts runs started, so what is shown of the run follows a new one. */
const runs = ref(0);
const playing = ref(false);
/** Steps played per second; when painting a step takes longer, playback skips ahead rather than slowing down. */
const speed = ref(8);
/** The run starts in spring with its high lakes full; the view opens at midsummer, the rivers worn in and running with melt. */
const OPENS_AT = YEAR / 4;
/** While playing, props settle around changed rivers and lakes at most once in this many steps. */
const SETTLE_EVERY = 4;
/** Moments the run keeps to go back to: a few years' worth. */
const KEPT = 64;
let frame = 0;

function startRun(): void {
  stopPlaying();
  const { grid } = map;
  if (grid.elevation.some((e) => e > 0)) {
    const world = hydroWorldOf(grid, 12, map.water);
    const cycle = createWaterCycle(world, { cover: groundCoverOf(grid), params, seed: seed.value });
    const eco = createEcosystem(cycle, plantRoomOf(grid), seed.value);
    const deck = createDeck(deckMap(grid.cols, grid.rows, HEX, gridFrame(grid.cols, grid.rows, HEX)), seed.value);
    const lakes = (map.water ?? []).flatMap((d, i) => (d > 0 ? [i] : []));
    run = { water: createRun(ecoModel(eco), Infinity, 40, KEPT), eco, topo: world.topo, ground: Float32Array.from(grid.elevation), deck, map, lakes };
  } else run = null;
  step.value = steps.value = run ? OPENS_AT : 0;
  firstStep.value = 0;
  lifeShown = undefined;
  aimed = false;
  runs.value++;
}

/** Year, season and step of the moment shown, and the weather then. */
const clock = computed(() => {
  if (!run || !steps.value || !runs.value) return '';
  return `Year ${Math.floor(step.value / YEAR) + 1} · ${seasonOf(run.water.at(step.value).sky.yearShare)} · step ${step.value}`;
});
const weatherNow = computed(() => (run && steps.value && runs.value ? climateReadout(run.water.at(step.value).sky, run.ground) : ''));

/** A setting changed: the run reads it from now on, and forgets the future it ran with the old one. */
function tweak(k: number, value: number): void {
  settings.value[k] = value;
  setValue(params, CLIMATE_SETTINGS[k], value);
  run?.water.forget();
  steps.value = step.value;
}

function resetClimate(): void {
  const defaults = defaultClimate();
  CLIMATE_SETTINGS.forEach((s: ClimateSetting, k) => tweak(k, valueOf(defaults, s)));
}
/** The water as the run has it now: what stands where and how it flows. */
const waterNow = () => {
  if (!run) return undefined;
  const { depth, flux, ground, wetness, river } = timed('water step', () => run!.water.at(step.value));
  return { depth, flux, ground, wetness, river, topo: run.topo };
};

function stopPlaying(): void {
  cancelAnimationFrame(frame);
  playing.value = false;
  between = 1;
}

function togglePlay(): void {
  if (playing.value) return stopPlaying();
  playing.value = true;
  let [last, at] = [performance.now(), step.value];
  const tick = (now: number) => {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    at += dt * speed.value;
    if (Math.floor(at) !== step.value) step.value = Math.floor(at);
    between = at - step.value;
    steps.value = Math.max(steps.value, step.value);
    if (run) firstStep.value = run.water.first;
    skyTime += dt;
    if (camera.zoom > 1 && camera.follow && cameraBehind()) draw();
    const field = skyField();
    if (field) run!.deck.update(field, dt * speed.value);
    drawSky();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
}

/** The wind made visible, over everything: while Shift is held, or when switched on. */
const windCanvas = ref<HTMLCanvasElement | null>(null);
const shift = ref(false);
const windOn = ref(false);
const onKey = (e: KeyboardEvent) => {
  if (e.type === 'keydown' && steer(e)) return;
  if (e.key !== 'Shift' || shift.value === (e.type === 'keydown')) return;
  shift.value = e.type === 'keydown';
};
const offKey = () => (shift.value = false);
/** Whether the wind layer holds arrows now: only then is there anything to clear. */
let windDrawn = false;

function drawWindLayer(): void {
  const el = windCanvas.value;
  const box = host.value;
  if (!el || !box) return;
  const show = (shift.value || windOn.value) && run && run.map === map && placed && scene?.grid === map.grid;
  if (!show && !windDrawn) return;
  const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
  fit(el, box.clientWidth, box.clientHeight, dpr);
  const ctx = el.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, el.width, el.height);
  windDrawn = !!show;
  if (!show || !run || !placed) return;
  const { sky } = run.water.at(step.value);
  const { cols } = map.grid;
  const frame = gridFrame(cols, map.grid.rows, HEX);
  const t = placed;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const arrows = windArrows(sky, (i) => frameCentre(i % cols, Math.floor(i / cols), HEX, frame), Math.sqrt(3) * HEX, { scale: t.scale, x: t.x, y: t.y, squash: SQUASH });
  drawWind(ctx, arrows, { x: box.clientWidth - 150, y: 12 });
}

/** The creatures, over the map and under the clouds: they glide from one step's place to the next. */
const lifeCanvas = ref<HTMLCanvasElement | null>(null);
const showLife = ref(true);
const hovered = ref('');
const sprites = new CreatureSprites();
/** How far playback is between the step shown and the next (1: at the step itself, when paused). */
let between = 1;
/** The life of the step shown and of the one before it, to glide between. */
let lifeShown: { step: number; prev?: Shown; cur: Shown } | undefined;
interface Shown {
  life: LifeSnapshot;
  avatar: Avatar;
}
let placedLife: Placed[] = [];

/** The life (and the avatar) of the step shown, and of the step before it if that was the one shown last. */
function lifeNow(): { prev?: Shown; cur: Shown } | undefined {
  if (!run || run.map !== map) return undefined;
  if (lifeShown?.step !== step.value) {
    const { life, avatar } = run.water.at(step.value);
    const cur = { life, avatar };
    lifeShown = { step: step.value, prev: lifeShown && lifeShown.step === step.value - 1 ? lifeShown.cur : undefined, cur };
  }
  return lifeShown;
}

function drawLife(): void {
  const el = lifeCanvas.value;
  const box = host.value;
  if (!el || !box) return;
  const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
  fit(el, box.clientWidth, box.clientHeight, dpr);
  const ctx = el.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, el.width, el.height);
  const life = showLife.value ? lifeNow() : undefined;
  const s = scene;
  if (!life || !placed || !s || s.grid !== map.grid) return void (placedLife = []);
  const t = placed;
  const { cols, rows } = map.grid;
  const spacing = Math.sqrt(3) * HEX;
  const toScreen = (x: number, y: number) => {
    const i = hexAt(cols, rows, x, y);
    const lift = tileAt(s, i % cols, Math.floor(i / cols))?.lift ?? 0;
    return projectToScreen(s, t, { x: s.frame.ox + x * spacing, y: s.frame.oy + y * spacing }, lift);
  };
  const [view, time] = [{ toScreen, spacing: spacing * t.scale }, performance.now() / 1000];
  placedLife = placeCreatures(life.prev?.life.creatures, life.cur.life.creatures, between, view, time);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  timed('life', () => drawCreatures(ctx, placedLife, sprites, time));
  drawAvatar(ctx, placeAvatar(life.prev?.avatar, life.cur.avatar, between, view, time), time);
}

/** The life the panel shows: the kinds alive, the mystic creatures called. */
const lifeNowShown = computed(() => (run && steps.value && runs.value ? run.water.at(step.value).life : undefined));
const kindsNow = computed(() => (lifeNowShown.value ? kindRows(lifeNowShown.value) : []));
const callsNow = computed(() => (lifeNowShown.value ? callRows(lifeNowShown.value) : []));
const creaturesNow = computed(() => kindsNow.value.reduce((n, r) => n + r.count, 0));
const releaseKind = ref(RELEASABLE[0].kind);
/** On a wide screen the panels open by themselves; on a phone they would cover the map, so they wait behind the menu button. */
const wide = window.innerWidth >= 720;
const panelOpen = ref(wide);

/** The view: on a phone it starts zoomed in on the avatar, following it; on a wide screen, the whole map. */
const camera = reactive<Camera>({ zoom: wide ? 1 : 2.4, follow: true, centre: { x: 0, y: 0 } });
/** Share of the way the camera eases towards the avatar each frame. */
const FOLLOW = 0.12;

/** Where the avatar is drawn now, in frame px, if it is shown. */
function avatarInFrame(): { x: number; y: number } | undefined {
  const life = lifeShown;
  const s = scene;
  if (!life || !s) return undefined;
  const [a, b] = [life.prev?.avatar ?? life.cur.avatar, life.cur.avatar];
  const t = playing.value ? between : 1;
  return mapToFrame({ ox: s.frame.ox, oy: s.frame.oy, spacing: Math.sqrt(3) * HEX }, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
}

/** Whether the camera has been put on the avatar yet, on this map. */
let aimed = false;

/** Whether the camera is behind the avatar by a pixel or more on screen: only then is the map drawn anew to follow it. */
function cameraBehind(): boolean {
  const to = avatarInFrame();
  return !!to && !!placed && Math.hypot(to.x - camera.centre.x, (to.y - camera.centre.y) * SQUASH) * placed.scale >= 1;
}

/** The camera on to its spot: the avatar, if it follows; the first time, there at once. */
function aimCamera(at = FOLLOW): void {
  lifeNow();
  const to = camera.follow ? avatarInFrame() : undefined;
  if (!to) return;
  ease(camera, to, aimed ? at : 1);
  aimed = true;
}

function zoomIn(factor: number): void {
  if (camera.zoom === 1 && factor > 1) aimCamera(1);
  zoomBy(camera, factor);
  schedule(draw);
}

function followAvatar(): void {
  camera.follow = true;
  if (camera.zoom === 1) zoomBy(camera, 2.4);
  schedule(draw);
}

/** Fingers (or the mouse) on the map: one dragged pans, two pinched zoom; a touch that hardly moved is a tap. */
const fingers = new Map<number, { x: number; y: number }>();
let dragged = false;
let pinched = 0;
/** Px a finger may move and still tap. */
const TAP = 8;
let downAt = { x: 0, y: 0 };

function press(e: PointerEvent): void {
  if (!fingers.size) [dragged, downAt] = [false, { x: e.clientX, y: e.clientY }];
  fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  point(e);
}

function drag(e: PointerEvent): void {
  const was = fingers.get(e.pointerId);
  if (!was) return point(e);
  fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (fingers.size === 2) {
    const [a, b] = [...fingers.values()];
    const apart = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinched) zoomBy(camera, apart / pinched);
    [pinched, dragged] = [apart, true];
    return schedule(draw);
  }
  if (!dragged && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < TAP) return;
  dragged = true;
  if (camera.zoom > 1 && placed) pan(camera, e.clientX - was.x, e.clientY - was.y, placed.scale, SQUASH);
  schedule(draw);
}

function letGo(e: PointerEvent): void {
  fingers.delete(e.pointerId);
  pinched = 0;
  lift(e);
}

function wheel(e: WheelEvent): void {
  e.preventDefault();
  zoomIn(e.deltaY < 0 ? 1.15 : 1 / 1.15);
}
/** Creatures let in at a time. */
const RELEASE = 4;

/** Do something now: the run forgets the future it ran without it (and what was done in it), and plays on. */
function act(c: Command): void {
  if (!run) return;
  forgetCommands(run.eco, step.value);
  command(run.eco, step.value, c);
  run.water.forget();
  steps.value = step.value;
  if (!playing.value) togglePlay();
}

/** Let a few creatures of the chosen kind in now. */
const releaseNow = () => act({ do: 'release', kind: releaseKind.value, count: RELEASE });

/** The avatar as the step shown has it. */
const avatarNow = computed(() => (run && steps.value && runs.value ? run.water.at(step.value).avatar : undefined));
/** For the developer: the hex the avatar stands on as the step shown has it, to see a gift work (switched off in the menu). */
const devOn = ref(true);
const hexNow = computed(() => {
  if (!devOn.value || !run || !steps.value || !runs.value) return '';
  const v = run.water.at(step.value);
  const i = hexAt(map.grid.cols, map.grid.rows, v.avatar.x, v.avatar.y);
  return hexReadout({ ...v.sky, wetness: v.wetness, snow: v.snow, plants: v.life.plants, room: v.life.room }, i, run.eco.life.food.base);
});
const giftColour = (g: Gift) => ELEMENT_LOOK[GIFTS[g].element].colour;
const toggleGift = (g: Gift) => act({ do: 'gift', gift: avatarNow.value?.gift === g ? null : g });
const takeForm = (form: Form) => act({ do: 'form', form });

/** Where on the map a point on the stage is, if the map is shown. */
function mapPlace(sx: number, sy: number): { x: number; y: number } | undefined {
  const s = scene;
  if (!s || !placed || s.grid !== map.grid) return undefined;
  return screenToMap({ ox: s.frame.ox, oy: s.frame.oy, spacing: Math.sqrt(3) * HEX }, { ...placed, squash: SQUASH }, sx, sy);
}

/** A tap or click on the map sends the avatar there. */
function sendAvatar(e: MouseEvent): void {
  if (dragged) return void (dragged = false);
  const box = host.value!.getBoundingClientRect();
  const to = mapPlace(e.clientX - box.left, e.clientY - box.top);
  const { cols, rows } = map.grid;
  if (to && to.x >= -0.5 && to.x <= cols && to.y >= -0.5 && to.y <= rows * 0.87) act({ do: 'go', x: to.x, y: to.y });
}

/** Steps the arrow keys and WASD send the avatar, in hex spacings. */
const KEY_STEPS: Record<string, [number, number]> = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };

/** The keys that steer the avatar: arrows and WASD walk it on, 1–6 work a gift (again: stop), 0 or Escape stop. Whether the key was one. */
function steer(e: KeyboardEvent): boolean {
  const a = avatarNow.value;
  if (!a || (e.target as HTMLElement)?.closest?.('input, select, textarea')) return false;
  const move = KEY_STEPS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  const gift = GIFT_ORDER.find((g) => GIFTS[g].key === e.key);
  if (move) {
    const from = a.target ?? a;
    act({ do: 'go', x: from.x + move[0], y: from.y + move[1] * 0.87 });
  } else if (gift) toggleGift(gift);
  else if ((e.key === '0' || e.key === 'Escape') && a.gift) act({ do: 'gift', gift: null });
  else return false;
  e.preventDefault();
  return true;
}

/** The sky over the map, on the GPU (when there is WebGL2): clouds, their shadows, rain and snow. */
const skyCanvas = ref<HTMLCanvasElement | null>(null);
let skyGl: CloudGL | undefined;
const cloudMode = ref<SkyLook['mode'] | 'off'>('see-through');
/** Clouds float this high (frame px) over the ground. */
const ALTITUDE = 1.3 * HEX;
/** The sky is soft: drawn at one canvas pixel per CSS pixel, however sharp the screen. */
const SKY_DPR = 1;
/** Where the player points, in CSS px over the map, if anywhere; and the sky's clock (s), for falling rain. */
let focus: { x: number; y: number } | undefined;
let skyTime = 0;
/** Where the map was last drawn on the canvas. */
let placed: ViewTransform | undefined;

/** The sky the run has now, for the clouds to follow. */
function skyField(): SkyField | undefined {
  if (!run || run.map !== map) return undefined;
  const { sky } = run.water.at(step.value);
  return { cloud: sky.cloud, fall: sky.fall, windX: sky.windX, windY: sky.windY, snow: (i) => sky.temperature[i] < 0 };
}

/** The clouds as the sky has them now, at once: after a jump in time or a new map. */
function resetSky(): void {
  const field = skyField();
  if (field) run!.deck.reset(field);
  drawSky();
}

function drawSky(): void {
  drawWindLayer();
  drawLife();
  const el = skyCanvas.value;
  const box = host.value;
  if (!skyGl || !el || !box) return;
  const dpr = Math.min(SKY_DPR, window.devicePixelRatio || 1);
  fit(el, box.clientWidth, box.clientHeight, dpr);
  if (cloudMode.value === 'off' || !run || run.map !== map || !placed || scene?.grid !== map.grid) return skyGl.clear();
  const t = placed;
  const look: SkyLook = { mode: cloudMode.value, focus: focus && { x: focus.x * dpr, y: focus.y * dpr }, time: skyTime };
  timed('sky', () => skyGl!.render(run!.deck.puffs, { scale: t.scale * dpr, x: t.x * dpr, y: t.y * dpr, squash: SQUASH, altitude: ALTITUDE }, look, Math.sqrt(3) * HEX * t.scale * dpr));
}

function point(e: PointerEvent): void {
  const box = host.value!.getBoundingClientRect();
  focus = { x: e.clientX - box.left, y: e.clientY - box.top };
  const near = creatureAt(placedLife, focus.x, focus.y);
  const view = near && lifeShown?.cur.life.creatures.find((c) => c.id === near.id);
  hovered.value = view ? describe(view) : '';
  if (!playing.value) schedule(drawSky);
}

/** A finger lifted off the map: the clouds close again over where it was (a mouse keeps its place). */
function lift(e: PointerEvent): void {
  if (e.pointerType === 'mouse') return;
  focus = undefined;
  if (!playing.value) schedule(drawSky);
}

function unpoint(): void {
  focus = undefined;
  hovered.value = '';
  if (!playing.value) schedule(drawSky);
}

const groundTextures = () => (useArt.value ? { ...placeholders, ...art } : placeholders);

/** High lakes are painted in a worker, so playing the water never waits on them; a new painting repaints the view. */
const lakeWorker = new Worker(new URL('../../tiles/lakeWorker.ts', import.meta.url), { type: 'module' });
const lakes = asyncLakes((request) => lakeWorker.postMessage(request), () => schedule(repaintWater), LAKE_SETTLES);
lakeWorker.onmessage = ({ data }: MessageEvent<LakeReply>) => lakes.receive(data);

/** Run `f` once on the next animation frame, however often asked before it. */
const pending = new Set<() => void>();
function schedule(f: () => void): void {
  if (!pending.size)
    requestAnimationFrame(() => {
      const due = [...pending];
      pending.clear();
      due.forEach((g) => g());
    });
  pending.add(f);
}

/** The lakes' weather: the run's, where the climate is simulated; else as set by hand. */
function lakeOptions(): LakeOptions {
  const sky = run && run.map === map ? run.water.at(step.value).sky : undefined;
  return {
    hexSize: HEX,
    view: { squash: SQUASH, thickness: THICKNESS },
    groundElsewhere: !!groundGl,
    settleEvery: playing.value ? SETTLE_EVERY : 1,
    weather: sky
      ? lakeWeather(sky, run!.ground, run!.lakes)
      : { warmth: season.value / 100, wind: { strength: wind.value / 100, direction: (windDir.value * Math.PI) / 180 } },
  };
}

/** Painters of the map's base terrain: workers side by side, as many as the device has cores to spare. */
const PAINTERS = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
const baseWorkers = Array.from({ length: PAINTERS }, () => new Worker(new URL('../../tiles/baseWorker.ts', import.meta.url), { type: 'module' }));
const painters = workerPainters(baseWorkers);
/** The ground's detail for this hex size, made by a painter while the first map's ground is painted. */
const detail = painters.detail(HEX / ART_HEX);
/** The latest build asked for: an older one still painting is dropped when it comes in. */
let building = 0;

async function rebuild(): Promise<void> {
  const token = ++building;
  // The flat map draws the high basins' water apart, as the run has it; the relief style shows them full.
  const flat = mountainStyle.value === 'sprites';
  const grid = flat ? map.grid : floodedGrid(map.grid, map.water);
  const textures = groundTextures();
  const reliefOptions = { height: (relief.value / 100) * HEX_ROW, style: mountainStyle.value, contours: contours.value };
  const start = performance.now();
  const painted = Promise.all([
    painters.base({ grid, textures, frame: gridFrame(grid.cols, grid.rows, HEX), size: HEX, seed: seed.value, relief: reliefOptions, blend: blend.value }),
    detail,
  ]);
  // While the painters paint, run the water up to where the view opens.
  const water = flat ? waterNow() : undefined;
  const [base, groundDetail] = await painted;
  performance.measure('base', { start, end: performance.now() });
  if (token !== building) return;
  labels = map.labels;
  renderer.sprites = useArt.value ? { ...placeholderSprites, ...artSprites } : placeholderSprites;
  renderer.walls = useArt.value ? artWalls : {};
  scene = timed('build', () =>
    buildScene(grid, textures, {
      ...lakeOptions(),
      highWater: flat ? map.water : undefined,
      lakes: useArt.value ? artLakes : undefined,
      lakeSource: lakes.source,
      water,
      seed: seed.value,
      blend: blend.value,
      relief: reliefOptions,
      base,
      detail: groundDetail,
      cliff: useArt.value ? artCliff : undefined,
      poolFace: useArt.value ? artPoolFace : undefined,
    }),
  );
  draw();
  resetSky();
}

function repaintWater(): void {
  // Not while a new map is still being built: the scene shown is of the old one.
  if (!scene || mountainStyle.value !== 'sprites' || scene.grid !== map.grid) return;
  scene = timed('water paint', () => paintLakes(scene!, groundTextures(), lakeOptions(), waterNow() ?? { depth: map.water ?? [] }));
  draw();
}

function drawLabels(ctx: CanvasRenderingContext2D, s: Scene, t: ViewTransform): void {
  ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(10, 10, 16, 0.85)';
  ctx.fillStyle = '#fff';
  for (const l of labels) {
    const c = frameCentre(l.col, l.row, HEX, s.frame);
    const p = projectToScreen(s, t, { x: c.x, y: c.y - HEX * 1.05 }, tileAt(s, l.col, l.row)?.lift ?? 0);
    ctx.strokeText(l.text, p.x, p.y);
    ctx.fillText(l.text, p.x, p.y);
  }
}

/** Size a canvas to its box in device pixels; only when that changed, as resizing clears and reallocates it. */
function fit(el: HTMLCanvasElement, w: number, h: number, dpr: number): void {
  const [cw, ch] = [Math.max(1, Math.floor(w * dpr)), Math.max(1, Math.floor(h * dpr))];
  if (el.width !== cw || el.height !== ch) [el.width, el.height] = [cw, ch];
}

function draw(): void {
  const el = canvas.value;
  const box = host.value;
  if (!el || !box || !scene) return;
  const s = scene;
  // Sharper than 2 device px per CSS px is lost on the eye but not on the GPU: phones at 3 draw half as many pixels.
  const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
  const { clientWidth: w, clientHeight: h } = box;
  fit(el, w, h, dpr);
  const ctx = el.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  aimCamera();
  const t = cameraTransform(fitTransform(s, w, h, 48), camera, { width: w, height: h }, s.frame, SQUASH);
  placed = t;
  const onGpu = !!(groundGl && s.look && s.wet);
  if (groundGl && groundCanvas.value) {
    fit(groundCanvas.value, w, h, dpr);
    const water = groundTextures().water[0];
    const season = seasonNow();
    if (onGpu) timed('ground', () => groundGl!.render(s.ground, s.wet!, s.look!, water, { scale: t.scale * dpr, x: t.x * dpr, y: t.y * dpr, squash: SQUASH }, season));
    else groundGl.clear();
  }
  timed('draw', () => renderer.draw(ctx, s, t, { grid: showGrid.value, ground: !onGpu }));
  drawLabels(ctx, s, t);
  if (!playing.value) drawSky();
}

/** The season's look of the step shown: snow, ice and plants as the run has them (worked out once per step; while playing, every few steps). */
let seasonShown: { step: number; runs: number; look: SeasonLook } | undefined;
function seasonNow(): SeasonLook | undefined {
  if (!run || run.map !== map) return undefined;
  const fresh = seasonShown && seasonShown.runs === runs.value && Math.abs(seasonShown.step - step.value) < (playing.value ? SETTLE_EVERY : 1);
  if (!fresh) {
    const v = run.water.at(step.value);
    seasonShown = { step: step.value, runs: runs.value, look: seasonLook({ snow: v.snow, depth: v.depth, ground: v.ground, surface: v.sky.surface, plants: v.life.plants, room: v.life.room }, run.eco.life.food.base) };
  }
  return seasonShown!.look;
}

function newMap(): void {
  map = demoMap(mapId.value, seed.value);
  startRun();
  rebuild();
}

onMounted(() => {
  if (groundCanvas.value && new URLSearchParams(window.location.search).get('gpu') !== '0') groundGl = GroundGL.create(groundCanvas.value);
  startRun();
  rebuild();
  // Placeholder cloud art, painted while the map's ground is painted in the workers.
  const cell = Math.round(Math.min(192, Math.max(128, HEX * 4.8)));
  if (skyCanvas.value) skyGl = CloudGL.create(skyCanvas.value, cloudAtlas(cell, Math.round((cell * 2) / 3)));
  Promise.all([loadGroundTextures(TEXTURE_FILES, textureSize(HEX)), loadSprites(HEX), loadWalls(), loadCliff(HEX), loadPoolFace(HEX), loadLakeKit(HEX)])
    .then(([textures, sprites, walls, cliff, poolFace, lakes]) => {
      art = textures;
      artSprites = sprites;
      artWalls = walls;
      artCliff = cliff;
      artPoolFace = poolFace;
      artLakes = lakes;
      rebuild();
    })
    .catch((e) => console.error('Tile art failed to load', e));
  resizeObs = new ResizeObserver(draw);
  if (host.value) resizeObs.observe(host.value);
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('blur', offKey);
});
onBeforeUnmount(() => {
  resizeObs?.disconnect();
  lakeWorker.terminate();
  baseWorkers.forEach((w) => w.terminate());
  stopPlaying();
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('keyup', onKey);
  window.removeEventListener('blur', offKey);
});

watch([mapId, seed], newMap);
watch([blend, useArt, relief, mountainStyle, contours], rebuild);
watch([step, season, wind, windDir], repaintWater);
watch(step, () => playing.value || resetSky());
watch(showGrid, draw);
watch(cloudMode, drawSky);
watch(showLife, drawSky);
watch([shift, windOn], drawWindLayer);
</script>

<template>
  <div class="tiles">
    <div ref="host" class="stage" @pointermove="drag" @pointerdown="press" @pointerup="letGo" @pointercancel="letGo" @pointerleave="unpoint" @click="sendAvatar" @wheel="wheel">
      <canvas ref="groundCanvas" /><canvas ref="canvas" /><canvas ref="lifeCanvas" class="sky" /><canvas ref="skyCanvas" class="sky" /><canvas ref="windCanvas" class="sky" />
    </div>
    <button class="menu" type="button" :aria-expanded="panelOpen" :title="panelOpen ? 'Hide settings' : 'Settings'" @click="panelOpen = !panelOpen">{{ panelOpen ? '✕' : '☰' }}</button>
    <div class="zoom">
      <button type="button" title="Closer" @click="zoomIn(1.4)">＋</button>
      <button type="button" title="Further" @click="zoomIn(1 / 1.4)">－</button>
      <button type="button" :class="{ on: camera.follow && camera.zoom > 1 }" title="Follow me" @click="followAvatar">◎</button>
    </div>
    <div v-if="steps > 0 && avatarNow" class="hud">
      <p v-if="hexNow" class="hud-line dev" title="The hex you stand on: air temperature, cloud cover, rain, ground wetness, plants of the most it grows now">{{ hexNow }}</p>
      <p class="hud-line">{{ hovered || (avatarNow.gift ? `${GIFTS[avatarNow.gift].name}: ${GIFTS[avatarNow.gift].hint.toLowerCase()}` : `${clock} · tap the map to walk`) }}</p>
      <div class="hud-row">
        <button type="button" class="play" :title="playing ? 'Pause' : 'Play'" @click="togglePlay">{{ playing ? '⏸' : '▶' }}</button>
        <button v-for="g in GIFT_ORDER" :key="g" type="button" class="gift" :class="{ on: avatarNow.gift === g }" :style="{ '--gift': giftColour(g) }" :title="`${GIFTS[g].hint} (key ${GIFTS[g].key})`" @click="toggleGift(g)">
          <span class="icon">{{ GIFTS[g].icon }}</span><span class="label">{{ GIFTS[g].name }}</span>
        </button>
      </div>
      <div class="spirit-bar" title="Spirit: gifts spend it, rest brings it back"><span :style="{ width: `${Math.round(avatarNow.spirit * 100)}%` }" /></div>
    </div>
    <div v-show="panelOpen" class="controls">
      <label>
        Map
        <select v-model="mapId">
          <option v-for="m in DEMO_MAPS" :key="m.id" :value="m.id">{{ m.name }}</option>
        </select>
      </label>
      <label>
        Seed
        <input v-model.number="seed" type="number" min="1" />
        <button type="button" title="New seed" @click="seed = 1 + Math.floor(Math.random() * 9999)">🎲</button>
      </label>
      <label>
        Edge blend {{ blend.toFixed(2) }}
        <input v-model.number="blend" type="range" min="0.3" max="1" step="0.05" />
      </label>
      <label>
        Mountains
        <select v-model="mountainStyle">
          <option value="sprites">Flat map</option>
          <option value="relief">Relief</option>
        </select>
      </label>
      <label>
        Relief {{ relief }}%
        <input v-model.lazy.number="relief" type="range" min="0" max="150" step="10" />
      </label>
      <label v-if="steps > 0">
        Water
        <button type="button" :title="playing ? 'Pause' : 'Play the water run'" @click="togglePlay">{{ playing ? '⏸' : '▶' }}</button>
        <input v-model.number="step" type="range" :min="firstStep" :max="steps" step="1" />
      </label>
      <p v-if="steps > 0" class="hint">{{ clock }}</p>
      <p v-if="steps > 0" class="hint">{{ weatherNow }}</p>
      <label v-if="steps > 0" class="check" title="Or hold Shift"><input v-model="windOn" type="checkbox" /> Wind (Shift)</label>
      <label v-if="steps > 0" class="check" title="What the hex you stand on is like now"><input v-model="devOn" type="checkbox" /> Hex readout</label>
      <label v-if="steps > 0">
        Speed {{ speed }}/s
        <input v-model.number="speed" type="range" min="2" max="48" step="2" />
      </label>
      <label v-if="steps > 0">
        Clouds
        <select v-model="cloudMode">
          <option value="see-through">See-through</option>
          <option value="solid">Solid</option>
          <option value="off">Off</option>
        </select>
      </label>
      <details v-if="steps > 0 && avatarNow" class="climate spirit" :open="wide">
        <summary>You · {{ FORMS[avatarNow.form].name }}</summary>
        <label>
          Form
          <select :value="avatarNow.form" @change="takeForm(($event.target as HTMLSelectElement).value as Form)">
            <option v-for="(f, key) in FORMS" :key="key" :value="key">{{ f.name }}</option>
          </select>
        </label>
        <p class="hint">Tap the map to walk there · arrows/WASD · gifts below, or keys 1–6</p>
      </details>
      <details v-if="steps > 0" class="climate life" :open="wide">
        <summary>Life · {{ creaturesNow }}</summary>
        <label class="check"><input v-model="showLife" type="checkbox" /> Creatures</label>
        <p v-for="c in callsNow" :key="c.kind" class="hint call">✦ {{ c.name }} is called by {{ c.need }} · {{ Math.round(c.share * 100) }}%</p>
        <div v-for="r in kindsNow" :key="r.kind" class="kind" :title="loreOf(r.kind)">
          <span class="chips"><span v-for="c in r.chips" :key="c.name" class="chip" :style="{ background: c.colour }" :title="c.name" /></span>
          <span class="name" :class="{ mystic: r.mystic }">{{ r.mystic ? '✦ ' : '' }}{{ r.name }}</span>
          <span class="value">{{ r.count }}<small v-if="r.away"> ({{ r.away }} away)</small><small v-else-if="r.asleep"> ({{ r.asleep }} asleep)</small></span>
        </div>
        <label>
          <select v-model.number="releaseKind">
            <option v-for="k in RELEASABLE" :key="k.kind" :value="k.kind">{{ k.name }}</option>
          </select>
          <button type="button" :title="`Let ${RELEASE} in`" @click="releaseNow">Release</button>
        </label>
      </details>
      <p v-if="hovered" class="hint">{{ hovered }}</p>
      <details v-if="steps > 0" class="climate">
        <summary>Climate</summary>
        <label v-for="(s, k) in CLIMATE_SETTINGS" :key="s.key" :title="s.hint">
          <span class="name">{{ s.label }}</span>
          <input type="range" :min="s.min" :max="s.max" :step="s.step" :value="settings[k]" @input="tweak(k, +($event.target as HTMLInputElement).value)" />
          <span class="value">{{ settings[k] }}</span>
        </label>
        <button type="button" @click="resetClimate">Reset</button>
      </details>
      <template v-else>
        <label>
          Season {{ season < 0 ? 'winter' : season > 0 ? 'summer' : 'spring' }}
          <input v-model.number="season" type="range" min="-100" max="100" step="10" />
        </label>
        <label>
          Wind {{ wind }}%
          <input v-model.number="wind" type="range" min="0" max="100" step="5" />
          <input v-model.number="windDir" type="range" min="0" max="360" step="15" title="Wind direction" class="dir" />
        </label>
      </template>
      <label class="check"><input v-model="showGrid" type="checkbox" /> Hex grid</label>
      <label class="check"><input v-model="contours" type="checkbox" /> Height lines</label>
      <label class="check"><input v-model="useArt" type="checkbox" /> Generated art</label>
      <p v-if="mapId === 'levels'" class="hint">Rows: water · grass · trees (levels 0 → 4) · height</p>
    </div>
  </div>
</template>

<style scoped>
.tiles {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 50% 40%, #23324a 0%, #0f1520 75%);
}
.stage { position: absolute; inset: 0; touch-action: none; }
canvas { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
canvas.sky { pointer-events: none; }
.controls {
  position: absolute;
  top: 52px;
  left: 12px;
  max-width: calc(100% - 24px);
  max-height: calc(100% - 52px - 150px);
  overflow-y: auto;
  box-sizing: border-box;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background: rgba(20, 20, 28, 0.85);
  border: 1px solid #1f1f28;
  border-radius: 8px;
  font-size: 13px;
  color: #c2c2cc;
  backdrop-filter: blur(4px);
}
.controls label { display: flex; align-items: center; gap: 6px; }
.controls input[type='number'] { width: 64px; }
.controls input.dir { width: 60px; }
.controls .hint { margin: 0; font-size: 12px; color: #8a8a99; }
.controls .climate summary { cursor: pointer; }
.controls .climate { display: flex; flex-direction: column; gap: 4px; max-height: 45vh; overflow-y: auto; }
.controls .climate label { gap: 6px; }
.controls .climate .name { width: 96px; }
.controls .climate input { width: 110px; }
.controls .climate .value { width: 40px; text-align: right; font-variant-numeric: tabular-nums; }
.controls .life .kind { display: flex; align-items: center; gap: 6px; }
.controls .life label.check { justify-content: flex-start; }
.controls .life .chips { display: inline-flex; gap: 2px; width: 26px; }
.controls .life .chip { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.controls .life .name { flex: 1; min-width: 110px; }
.controls .life .name.mystic { color: #ffe08a; }
.controls .life .value { width: auto; min-width: 40px; }
.controls .life small { color: #8a8a99; }
.controls .call { color: #ffe08a; }
.menu {
  position: absolute;
  top: max(8px, env(safe-area-inset-top, 0px));
  right: 10px;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  border: 1px solid #1f1f28;
  background: rgba(20, 20, 28, 0.85);
  color: #e6e6f0;
  font-size: 18px;
  cursor: pointer;
  z-index: 7;
}
.zoom {
  position: absolute;
  right: 10px;
  bottom: calc(max(10px, env(safe-area-inset-bottom, 0px)) + 120px);
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 6;
}
.zoom button {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  border: 1px solid #1f1f28;
  background: rgba(20, 20, 28, 0.85);
  color: #e6e6f0;
  font-size: 18px;
  cursor: pointer;
  touch-action: manipulation;
}
.zoom button.on { color: #ffd23f; border-color: #ffd23f; }
.hud {
  position: absolute;
  left: 50%;
  bottom: max(10px, env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  width: min(560px, calc(100% - 16px));
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  background: rgba(20, 20, 28, 0.92);
  border: 1px solid #1f1f28;
  border-radius: 14px;
  z-index: 6;
  user-select: none;
  -webkit-user-select: none;
}
.hud-line { margin: 0; font-size: 12px; color: #b8b8c8; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hud-line.dev { color: #9fd3ff; white-space: normal; font-variant-numeric: tabular-nums; }
.hud-row { display: grid; grid-template-columns: 44px repeat(6, 1fr); gap: 6px; }
.hud button { min-height: 50px; border-radius: 10px; cursor: pointer; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
.hud .play { border: 1px solid #3a3a4c; background: #262634; color: #fff; font-size: 18px; }
.hud .gift { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; padding: 2px; border: 1.5px solid var(--gift); background: transparent; color: #e6e6f0; }
.hud .gift .icon { font-size: 20px; line-height: 1; }
.hud .gift .label { font-size: 10px; }
.hud .gift.on { background: var(--gift); color: #10101a; font-weight: 600; }
.spirit-bar { height: 6px; border-radius: 3px; background: #2a2a38; overflow: hidden; }
.spirit-bar span { display: block; height: 100%; background: linear-gradient(90deg, #ffd23f, #fff4c8); transition: width 0.2s; }
</style>
