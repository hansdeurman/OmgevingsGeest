<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { DEMO_MAPS, demoMap, floodedGrid, type DemoMap, type MapLabel } from '../../tiles/demoMaps';
import { ART_HEX, frameCentre, gridFrame } from '../../tiles/geometry';
import { IsoRenderer, fitTransform, projectToScreen, type ViewTransform, type WallImages } from '../../tiles/IsoRenderer';
import { loadSprites } from '../../tiles/imageSprites';
import { createPlaceholderSprites, type SpriteSet } from '../../tiles/placeholderSprites';
import { TEXTURE_FILES, loadCliff, loadGroundTextures, loadLakeKit, loadPoolFace, loadWalls, textureSize } from '../../tiles/imageTextures';
import type { LakeKit } from '../../tiles/highLakes';
import type { Raster } from '../../tiles/raster';
import type { MountainStyle } from '../../tiles/relief';
import { createPlaceholderTextures, type GroundTextures } from '../../tiles/placeholderTextures';
import { buildScene, paintLakes, tileAt, type LakeOptions, type Scene } from '../../tiles/scene';
import { hydroWorldOf } from '../../tiles/mapHydro';
import type { HexTopology } from '../../water/hexTopology';
import { createWaterRun, type WaterRun } from '../../water/waterRun';
import { phaseAt, phaseEnd, seasonScript, type WaterScript } from '../../water/waterScript';
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

/** The scripted water run of the current map, played as it goes. */
let run: { script: WaterScript; water: WaterRun; topo: HexTopology } | null = null;
const step = ref(0);
const steps = ref(0);
const playing = ref(false);
/** Steps played per second; when painting a step takes longer, playback skips ahead rather than slowing down. */
const STEPS_PER_SECOND = 12;
/** Years of weather in the water run. */
const YEARS = 3;
let frame = 0;

function startRun(): void {
  stopPlaying();
  const { grid, water } = map;
  if (water?.some((d) => d > 0)) {
    const world = hydroWorldOf(grid);
    const script = seasonScript(grid.cols, grid.rows, grid.elevation, water, YEARS);
    run = { script, water: createWaterRun(world, script), topo: world.topo };
  } else run = null;
  steps.value = run ? run.water.length : 0;
  step.value = run ? phaseEnd(run.script, 'Spring rain') + 20 : 0; // open just after the cloudburst, rivers running
}

const phase = computed(() => (run && steps.value ? phaseAt(run.script, step.value).label : ''));
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
  if (step.value >= steps.value) step.value = 0;
  playing.value = true;
  const [from, start] = [step.value, performance.now()];
  const tick = () => {
    step.value = Math.min(steps.value, from + Math.floor(((performance.now() - start) / 1000) * STEPS_PER_SECOND));
    if (step.value < steps.value) frame = requestAnimationFrame(tick);
    else stopPlaying();
  };
  frame = requestAnimationFrame(tick);
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

function lakeOptions(): LakeOptions {
  return {
    hexSize: HEX,
    view: { squash: SQUASH, thickness: THICKNESS },
    groundElsewhere: !!groundGl,
    weather: { warmth: season.value / 100, wind: { strength: wind.value / 100, direction: (windDir.value * Math.PI) / 180 } },
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
  const onGpu = !!(groundGl && s.look && s.wet);
  if (groundGl && groundCanvas.value) {
    fit(groundCanvas.value, w, h, dpr);
    const water = groundTextures().water[0];
    if (onGpu) timed('ground', () => groundGl!.render(s.ground, s.wet!, s.look!, water, { scale: t.scale * dpr, x: t.x * dpr, y: t.y * dpr, squash: SQUASH }));
    else groundGl.clear();
  }
  timed('draw', () => renderer.draw(ctx, s, t, { grid: showGrid.value, ground: !onGpu }));
  drawLabels(ctx, s, t);
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
watch(showGrid, draw);
</script>

<template>
  <div class="tiles">
    <div ref="host" class="stage"><canvas ref="groundCanvas" /><canvas ref="canvas" /></div>
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
        <input v-model.number="step" type="range" min="0" :max="steps" step="1" />
      </label>
      <p v-if="steps > 0" class="hint">Step {{ step }} / {{ steps }} · {{ phase }}</p>
      <label>
        Season {{ season < 0 ? 'winter' : season > 0 ? 'summer' : 'spring' }}
        <input v-model.number="season" type="range" min="-100" max="100" step="10" />
      </label>
      <label>
        Wind {{ wind }}%
        <input v-model.number="wind" type="range" min="0" max="100" step="5" />
        <input v-model.number="windDir" type="range" min="0" max="360" step="15" title="Wind direction" class="dir" />
      </label>
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
</style>
