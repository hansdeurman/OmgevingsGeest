<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { DEMO_MAPS, demoMap, type MapLabel } from '../../tiles/demoMaps';
import { frameCentre } from '../../tiles/geometry';
import { IsoRenderer, fitTransform, projectToScreen, type ViewTransform } from '../../tiles/IsoRenderer';
import { createPlaceholderSprites } from '../../tiles/placeholderSprites';
import { TEXTURE_FILES, loadGroundTextures } from '../../tiles/imageTextures';
import { createPlaceholderTextures, type GroundTextures } from '../../tiles/placeholderTextures';
import { buildScene, type Scene } from '../../tiles/scene';

const HEX = 40;
const VIEW = { squash: 0.65, thickness: 0.26 * HEX };

const host = ref<HTMLDivElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const mapId = ref(DEMO_MAPS[0].id);
const seed = ref(1);
const blend = ref(0.6);
const showGrid = ref(false);
const useArt = ref(true);

const placeholders = createPlaceholderTextures(128);
let art: Partial<GroundTextures> = {};
const renderer = new IsoRenderer(createPlaceholderSprites(HEX));
let scene: Scene | null = null;
let labels: MapLabel[] = [];
let resizeObs: ResizeObserver | null = null;

function rebuild(): void {
  const map = demoMap(mapId.value, seed.value);
  labels = map.labels;
  const textures = useArt.value ? { ...placeholders, ...art } : placeholders;
  scene = buildScene(map.grid, textures, { hexSize: HEX, seed: seed.value, blend: blend.value, view: VIEW });
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
    const p = projectToScreen(s, t, { x: c.x, y: c.y - HEX * 1.05 });
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

onMounted(() => {
  rebuild();
  loadGroundTextures(TEXTURE_FILES)
    .then((loaded) => {
      art = loaded;
      rebuild();
    })
    .catch((e) => console.error('Tile art failed to load', e));
  resizeObs = new ResizeObserver(draw);
  if (host.value) resizeObs.observe(host.value);
});
onBeforeUnmount(() => resizeObs?.disconnect());

watch([mapId, seed, blend, useArt], rebuild);
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
      <label class="check"><input v-model="showGrid" type="checkbox" /> Hex grid</label>
      <label class="check"><input v-model="useArt" type="checkbox" /> Generated art</label>
      <p v-if="mapId === 'levels'" class="hint">Rows: water · grass · trees, levels 0 → 4</p>
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
.controls .hint { margin: 0; font-size: 12px; color: #8a8a99; }
</style>
