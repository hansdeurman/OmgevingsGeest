<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { Camera } from '../../rendering/Camera';
import { CanvasRenderer } from '../../rendering/canvas/CanvasRenderer';
import type { Renderer } from '../../rendering/Renderer';
import { buildWorld } from '../../generation/WorldGenerator';
import { config, generationKeys } from '../../config/parameters';
import type { World } from '../../world/World';

const hostRef = ref<HTMLDivElement>();

let renderer: Renderer;
let world: World;
const camera = new Camera();
let raf = 0;
let resizeObs: ResizeObserver | null = null;

function regenerate() {
  world = buildWorld(config);
}

function frame() {
  if (renderer && world) renderer.render(world, camera);
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

  // Pan with drag.
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  host.addEventListener('mousedown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener('mouseup', () => { dragging = false; });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    camera.panBy(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
  });

  // Zoom with wheel, anchored on cursor.
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

// Regenerate only when generation-affecting params change. Render-only
// params (hex size, grid, shading) are picked up on the next frame.
watch(
  () => generationKeys.map((k) => config[k]),
  () => regenerate(),
);
</script>

<template>
  <div ref="hostRef" class="host"></div>
</template>

<style scoped>
.host {
  width: 100%;
  height: 100%;
  cursor: grab;
}
.host:active { cursor: grabbing; }
</style>
