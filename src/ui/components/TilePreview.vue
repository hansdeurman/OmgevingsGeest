<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
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
import { groundCoverOf, hydroWorldOf } from '../../tiles/mapHydro';
import type { HexTopology } from '../../water/hexTopology';
import { createRun, type Run } from '../../water/waterRun';
import { seasonOf, YEAR } from '../../water/sun';
import { createWaterCycle, cycleModel, defaultClimate, type CycleSnapshot } from '../../water/waterCycle';
import { CLIMATE_SETTINGS, climateReadout, setValue, valueOf, type ClimateSetting } from '../climateSettings';
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
const mapId = ref(DEMO_MAPS[0].id);
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
let run: { water: Run<CycleSnapshot>; topo: HexTopology; ground: Float32Array; deck: CloudDeck; map: DemoMap; lakes: number[] } | null = null;
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
const speed = ref(12);
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
    const deck = createDeck(deckMap(grid.cols, grid.rows, HEX, gridFrame(grid.cols, grid.rows, HEX)), seed.value);
    const lakes = (map.water ?? []).flatMap((d, i) => (d > 0 ? [i] : []));
    run = { water: createRun(cycleModel(cycle), Infinity, 40, KEPT), topo: world.topo, ground: Float32Array.from(grid.elevation), deck, map, lakes };
  } else run = null;
  step.value = steps.value = run ? OPENS_AT : 0;
  firstStep.value = 0;
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
    steps.value = Math.max(steps.value, step.value);
    if (run) firstStep.value = run.water.first;
    skyTime += dt;
    const field = skyField();
    if (field) run!.deck.update(field, dt * speed.value);
    drawSky();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
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
  if (!playing.value) schedule(drawSky);
}

function unpoint(): void {
  focus = undefined;
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
  const t = fitTransform(s, w, h, 48);
  placed = t;
  const onGpu = !!(groundGl && s.look && s.wet);
  if (groundGl && groundCanvas.value) {
    fit(groundCanvas.value, w, h, dpr);
    const water = groundTextures().water[0];
    if (onGpu) timed('ground', () => groundGl!.render(s.ground, s.wet!, s.look!, water, { scale: t.scale * dpr, x: t.x * dpr, y: t.y * dpr, squash: SQUASH }));
    else groundGl.clear();
  }
  timed('draw', () => renderer.draw(ctx, s, t, { grid: showGrid.value, ground: !onGpu }));
  drawLabels(ctx, s, t);
  if (!playing.value) drawSky();
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
});
onBeforeUnmount(() => {
  resizeObs?.disconnect();
  lakeWorker.terminate();
  baseWorkers.forEach((w) => w.terminate());
  stopPlaying();
});

watch([mapId, seed], newMap);
watch([blend, useArt, relief, mountainStyle, contours], rebuild);
watch([step, season, wind, windDir], repaintWater);
watch(step, () => playing.value || resetSky());
watch(showGrid, draw);
watch(cloudMode, drawSky);
</script>

<template>
  <div class="tiles">
    <div ref="host" class="stage" @pointermove="point" @pointerdown="point" @pointerleave="unpoint">
      <canvas ref="groundCanvas" /><canvas ref="canvas" /><canvas ref="skyCanvas" class="sky" />
    </div>
    <div class="controls">
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
.stage { position: absolute; inset: 0; }
canvas { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
canvas.sky { pointer-events: none; }
.controls {
  position: absolute;
  bottom: 12px;
  left: 12px;
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
</style>
