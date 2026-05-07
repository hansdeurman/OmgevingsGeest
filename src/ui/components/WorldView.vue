<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { Camera } from '../../rendering/Camera';
import { CanvasRenderer } from '../../rendering/canvas/CanvasRenderer';
import type { Renderer } from '../../rendering/Renderer';
import { buildWorld } from '../../generation/WorldGenerator';
import { config, generationKeys, HEX_PIXEL_SIZE } from '../../config/parameters';
import type { World } from '../../world/World';
import {
  AirFlowSimulation,
  addSource,
  fireBurst,
  placingSource,
  placementMode,
  windSources,
  windBursts,
  clearBursts,
  requestFieldClear,
} from '../../airflow';
import { gridPixelBounds, pixelToOffset, offsetToPixel } from '../../math/hex';

const hostRef = ref<HTMLDivElement>();

let renderer: Renderer;
let world: World;
let airFlow: AirFlowSimulation | null = null;
const camera = new Camera();
let raf = 0;
let lastFrameTime = 0;
let resizeObs: ResizeObserver | null = null;

// Source placement drag state, kept in world-pixel coords so the renderer
// can draw a preview directly without re-transforming.
const sourceDrag = ref<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(
  null,
);

/** Convert client (CSS) pixels to world-space pixels (the same coords that
 *  offsetToPixel produces). Mirrors the transform applied in CanvasRenderer. */
function clientToWorld(host: HTMLElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = host.getBoundingClientRect();
  const sx = clientX - rect.left;
  const sy = clientY - rect.top;
  const w = rect.width;
  const h = rect.height;
  const bounds = gridPixelBounds(world.width, world.height, HEX_PIXEL_SIZE);
  return {
    x: (sx - w / 2 - camera.x) / camera.zoom + bounds.x / 2,
    y: (sy - h / 2 - camera.y) / camera.zoom + bounds.y / 2,
  };
}

/** Magnitude scale for source vectors derived from drag length in world pixels. */
const SOURCE_DRAG_SCALE = 1 / 12;

function regenerate() {
  world = buildWorld(config);
  airFlow = new AirFlowSimulation(world);
}

function frame(now: number) {
  const dt = lastFrameTime ? Math.min(0.1, (now - lastFrameTime) / 1000) : 0;
  lastFrameTime = now;

  if (renderer && world) {
    // Honour clear requests (from the test-burst tooling) before the next
    // step so a fresh burst lands on a clean field.
    if (airFlow && requestFieldClear.value) {
      airFlow.clearField();
      requestFieldClear.value = false;
    }
    if (airFlow && config.showAirFlow && dt > 0) {
      airFlow.step(world, {
        ambientSpeed: config.windAmbientSpeed,
        ambientDirection: (config.windAmbientAngle * Math.PI) / 180,
        damping: config.windDamping,
        terrainCoupling: config.windTerrainCoupling,
        overcomeFactor: config.windOvercomeFactor,
        maxSpeed: config.windMaxSpeed,
        advection: config.windAdvection,
        smoothing: config.windSmoothing,
        densityDamping: config.windDensityDamping,
      }, dt, windSources, windBursts);
      // Bursts are one-shot — drain them after the step has stamped them in.
      if (windBursts.length) clearBursts();
    }
    renderer.render({
      world,
      camera,
      windField: config.showAirFlow && airFlow ? airFlow.field : undefined,
      windSources: config.showAirFlow ? windSources : undefined,
      densityReference: config.showDensity ? config.burstDensity : undefined,
      sourcePreview: sourceDrag.value ?? undefined,
    });
  }
  raf = requestAnimationFrame(frame);
}

onMounted(() => {
  const host = hostRef.value!;
  renderer = new CanvasRenderer();
  renderer.attach(host);
  renderer.resize(host.clientWidth, host.clientHeight);
  regenerate();

  resizeObs = new ResizeObserver(() => {
    renderer.resize(host.clientWidth, host.clientHeight);
  });
  resizeObs.observe(host);

  // Pointer state. We disambiguate two drag modes on mousedown:
  //   - placeSource: when placingSource is on, OR shift is held.
  //   - pan: otherwise.
  let mode: 'idle' | 'pan' | 'source' = 'idle';
  let panLastX = 0;
  let panLastY = 0;

  host.addEventListener('mousedown', (e) => {
    if (placingSource.value || e.shiftKey) {
      mode = 'source';
      const w = clientToWorld(host, e.clientX, e.clientY);
      // Snap source position to the centre of the picked hex.
      const cell = pixelToOffset(w.x, w.y, HEX_PIXEL_SIZE);
      const snapped = offsetToPixel(cell.col, cell.row, HEX_PIXEL_SIZE);
      sourceDrag.value = { start: snapped, end: w };
      e.preventDefault();
    } else {
      mode = 'pan';
      panLastX = e.clientX;
      panLastY = e.clientY;
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (mode === 'pan') {
      camera.panBy(e.clientX - panLastX, e.clientY - panLastY);
      panLastX = e.clientX;
      panLastY = e.clientY;
    } else if (mode === 'source' && sourceDrag.value) {
      sourceDrag.value = {
        start: sourceDrag.value.start,
        end: clientToWorld(host, e.clientX, e.clientY),
      };
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (mode === 'source' && sourceDrag.value) {
      const { start, end } = sourceDrag.value;
      const cell = pixelToOffset(start.x, start.y, HEX_PIXEL_SIZE);
      // Drag direction & length set the source vector; clamp to maxSpeed so
      // a wild drag doesn't immediately saturate the colour ramp.
      const dx = (end.x - start.x) * SOURCE_DRAG_SCALE;
      const dy = (end.y - start.y) * SOURCE_DRAG_SCALE;
      const mag = Math.hypot(dx, dy);
      const cap = config.windMaxSpeed;
      const k = mag > cap ? cap / mag : 1;
      const vx = dx * k;
      const vy = dy * k;
      // Branch on the *placement mode* chosen before the drag began. Bursts
      // fire once and disappear; continuous sources persist. Drag-placed
      // bursts deliberately do NOT clear the field — that's reserved for the
      // directional Test Burst buttons, which are explicit isolation runs.
      if (placementMode.value === 'burst') {
        fireBurst({
          col: cell.col,
          row: cell.row,
          vx,
          vy,
          density: config.burstDensity,
        });
      } else {
        addSource({ col: cell.col, row: cell.row, vx, vy });
      }
      // One-shot: leave placement mode after creating one source.
      placingSource.value = false;
      sourceDrag.value = null;
      e.preventDefault();
    }
    mode = 'idle';
  });

  host.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = host.getBoundingClientRect();
    const factor = Math.exp(-e.deltaY * 0.0015);
    camera.zoomAt(
      e.clientX - rect.left,
      e.clientY - rect.top,
      factor,
      rect.width / 2,
      rect.height / 2,
    );
  }, { passive: false });

  raf = requestAnimationFrame(frame);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  resizeObs?.disconnect();
  renderer?.detach();
});

watch(
  () => generationKeys.map((k) => config[k]),
  () => regenerate(),
);
</script>

<template>
  <div ref="hostRef" class="host" :class="{ placing: placingSource }"></div>
</template>

<style scoped>
.host {
  width: 100%;
  height: 100%;
  cursor: grab;
}
.host:active { cursor: grabbing; }
.host.placing { cursor: crosshair; }
.host.placing:active { cursor: crosshair; }
</style>
