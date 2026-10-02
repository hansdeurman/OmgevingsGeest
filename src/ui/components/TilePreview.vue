<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { DEMO_MAPS, demoMap, floodedGrid, type DemoMap, type MapLabel } from '../../tiles/demoMaps';
import { frameCentre } from '../../tiles/geometry';
import { IsoRenderer, fitTransform, projectToScreen, type ViewTransform, type WallImages } from '../../tiles/IsoRenderer';
import { loadSprites } from '../../tiles/imageSprites';
import { createPlaceholderSprites, type SpriteSet } from '../../tiles/placeholderSprites';
import { TEXTURE_FILES, loadCliff, loadGroundTextures, loadLakeKit, loadPoolFace, loadWalls } from '../../tiles/imageTextures';
import type { LakeKit } from '../../tiles/highLakes';
import type { Raster } from '../../tiles/raster';
import type { MountainStyle } from '../../tiles/relief';
import { createPlaceholderTextures, type GroundTextures } from '../../tiles/placeholderTextures';
import { buildScene, paintLakes, tileAt, type LakeOptions, type Scene } from '../../tiles/scene';
import { hydroWorldOf } from '../../tiles/mapHydro';
import type { HexTopology } from '../../water/hexTopology';
import type { HydroSnapshot } from '../../water/hydroWorld';
import { phaseAt, phaseEnd, runScript, seasonScript, type WaterScript } from '../../water/waterScript';

const HEX = 40;
const SQUASH = 0.65;
const THICKNESS = 0.26 * HEX;

const host = ref<HTMLDivElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
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

const placeholders = createPlaceholderTextures(128);
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

/** The scripted water run of the current map: every state, played back step by step. */
let run: { script: WaterScript; states: HydroSnapshot[]; topo: HexTopology } | null = null;
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
    run = { script, states: runScript(world, script), topo: world.topo };
  } else run = null;
  steps.value = run ? run.states.length - 1 : 0;
  step.value = run ? phaseEnd(run.script, 'Spring rain') + 20 : 0; // open just after the cloudburst, rivers running
}

const phase = computed(() => (run && steps.value ? phaseAt(run.script, step.value).label : ''));
/** The water as the run has it now: what stands where and how it flows. */
const waterNow = () => {
  if (!run) return undefined;
  const { depth, flux, ground } = run.states[Math.min(step.value, steps.value)];
  return { depth, flux, ground, topo: run.topo };
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

function lakeOptions(): LakeOptions {
  return {
    hexSize: HEX,
    view: { squash: SQUASH, thickness: THICKNESS },
    lakes: useArt.value ? artLakes : undefined,
    weather: { warmth: season.value / 100, wind: { strength: wind.value / 100, direction: (windDir.value * Math.PI) / 180 } },
  };
}

function rebuild(): void {
  labels = map.labels;
  renderer.sprites = useArt.value ? { ...placeholderSprites, ...artSprites } : placeholderSprites;
  renderer.walls = useArt.value ? artWalls : {};
  // The flat map draws the high basins' water apart, as the run has it; the relief style shows them full.
  const flat = mountainStyle.value === 'sprites';
  scene = buildScene(flat ? map.grid : floodedGrid(map.grid, map.water), groundTextures(), {
    ...lakeOptions(),
    highWater: flat ? map.water : undefined,
    water: flat ? waterNow() : undefined,
    seed: seed.value,
    blend: blend.value,
    relief: { height: (relief.value / 100) * HEX_ROW, style: mountainStyle.value, contours: contours.value },
    cliff: useArt.value ? artCliff : undefined,
    poolFace: useArt.value ? artPoolFace : undefined,
  });
  draw();
}

/** Only the water changed: repaint the lakes, keep the land. */
function repaintWater(): void {
  if (!scene || mountainStyle.value !== 'sprites') return;
  scene = paintLakes(scene, groundTextures(), lakeOptions(), waterNow() ?? { depth: map.water ?? [] });
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

function draw(): void {
  const el = canvas.value;
  const box = host.value;
  if (!el || !box || !scene) return;
  const dpr = window.devicePixelRatio || 1;
  const { clientWidth: w, clientHeight: h } = box;
  el.width = Math.max(1, Math.floor(w * dpr));
  el.height = Math.max(1, Math.floor(h * dpr));
  const ctx = el.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const t = fitTransform(scene, w, h, 48);
  renderer.draw(ctx, scene, t, { grid: showGrid.value });
  drawLabels(ctx, scene, t);
}

function newMap(): void {
  map = demoMap(mapId.value, seed.value);
  startRun();
  rebuild();
}

onMounted(() => {
  startRun();
  rebuild();
  Promise.all([loadGroundTextures(TEXTURE_FILES), loadSprites(HEX), loadWalls(), loadCliff(HEX), loadPoolFace(HEX), loadLakeKit(HEX)])
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
  stopPlaying();
});

watch([mapId, seed], newMap);
watch([blend, useArt, relief, mountainStyle, contours], rebuild);
watch([step, season, wind, windDir], repaintWater);
watch(showGrid, draw);
</script>

<template>
  <div class="tiles">
    <div ref="host" class="stage"><canvas ref="canvas" /></div>
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
canvas { display: block; width: 100%; height: 100%; }
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
