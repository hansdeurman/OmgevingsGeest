<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { Camera } from '../../rendering/Camera';
import { CanvasRenderer } from '../../rendering/canvas/CanvasRenderer';
import type { Renderer } from '../../rendering/Renderer';
import { buildWorld } from '../../generation/WorldGenerator';
import { config, generationKeys, gridDimensions, HEX_PIXEL_SIZE } from '../../config/parameters';
import type { World } from '../../world/World';
import {
  AirFlowSimulation,
  addSource,
  addSink,
  placingSource,
  placementMode,
  windSources,
  windSinks,
  windBursts,
  clearBursts,
  highlightedSourceIdx,
  highlightedSinkIdx,
  requestFieldClear,
} from '../../airflow';
import { gridPixelBounds, pixelToOffset, offsetToPixel, hexCorners } from '../../math/hex';

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
  airFlow.setBaseline(config.windDensityBaseline);
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
        downhillRatio: config.windDownhillRatio,
        overcomeFactor: config.windOvercomeFactor,
        maxSpeed: config.windMaxSpeed,
        advection: config.windAdvection,
        pushSharpness: config.windPushSharpness,
        smoothing: config.windSmoothing,
        densityDamping: config.windDensityDamping,
        pressure: config.windPressure,
        heightDensityLoss: config.windHeightDensityLoss,
        densityDiffusion: config.windDensityDiffusion,
        velocityDensityCoupling: config.windVelocityDensityCoupling,
        baseline: config.windDensityBaseline,
        turbulence: config.windTurbulence,
      }, dt, windSources, windBursts, windSinks);
      // Bursts are one-shot — drain them after the step has stamped them in.
      if (windBursts.length) clearBursts();
    }
    renderer.render({
      world,
      camera,
      windField: config.showAirFlow && airFlow ? airFlow.field : undefined,
      windSources: config.showAirFlow ? windSources : undefined,
      windSinks: config.showAirFlow ? windSinks : undefined,
      highlightedSourceIdx: highlightedSourceIdx.value,
      highlightedSinkIdx: highlightedSinkIdx.value,
      densityReference: config.showDensity ? config.densityDisplayMax : undefined,
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

  // First-mount test scenario: flatten the world and seed 12 outward-firing
  // burst sources in a ring at radius 5 hexes from the centre, every 30°.
  // Six of them sit on hex axes (the natural lattice directions), the other
  // six fall between axes — exactly the directions where single-neighbour
  // push used to lock up. With the new two-axis flux split they should all
  // propagate cleanly outward. Subsequent regenerates restore real terrain
  // and don't replant these sources.
  for (let i = 0; i < world.tiles.length; i++) world.tiles[i].height = 0;

  // Two test mountains the airflow has to deal with. Both are sampled in
  // *pixel* space (a continuous height function) so the smooth profile
  // doesn't pick up the hex-row zigzag.
  //
  // We sample the function not just at every cell's centre, but also at
  // every cell's six corners. The renderer reads tile.cornerHeights
  // directly, so the wall edge follows the function's actual edge in
  // pixel space — the half-on / half-off cells around the wall axis end
  // up with corner heights that combine to a clean straight visual edge,
  // instead of inheriting a stair-stepped average from neighbour cells.
  //   - Thin straight wall, hard plateau in pixel space, smooth taper.
  //   - Conical mountain, isotropic gaussian peak.
  {
    const { width, height } = gridDimensions(config.hexCount);
    const cx = Math.floor(width / 2);
    const cy = Math.floor(height / 2);

    const wallCenterPx = offsetToPixel(cx + 10, cy, HEX_PIXEL_SIZE);
    const wallHalfWidth = HEX_PIXEL_SIZE * 0.5;       // pixel-space half-width
    const wallTaperPerp = HEX_PIXEL_SIZE * 0.5;       // perpendicular taper
    const wallHalfLen = 4 * HEX_PIXEL_SIZE * 1.5;     // ~4 hexes top/bottom
    const wallEndSigma = HEX_PIXEL_SIZE * 1.5;        // gaussian taper at ends

    const mtnCenterPx = offsetToPixel(cx - 10, cy, HEX_PIXEL_SIZE);
    const mtnSigma = HEX_PIXEL_SIZE * 2.2;            // ~2.2 hex peak sigma

    // Sample the wall + mountain combined height function at any pixel
    // position. Plateau-with-taper for the wall: full height inside a thin
    // axis-aligned rectangle, gaussian falloff perpendicular and at the
    // ends. Sharp visual edge in pixel space; the renderer can then ask
    // for the function value at any corner and get a clean wall edge.
    function sampleHeight(px: number, py: number): number {
      // Wall.
      const wdx = px - wallCenterPx.x;
      const wdy = py - wallCenterPx.y;
      const wdxAbs = Math.abs(wdx);
      const wdyAbs = Math.abs(wdy);
      const wPerp = wdxAbs <= wallHalfWidth
        ? 1
        : Math.exp(-((wdxAbs - wallHalfWidth) ** 2) / (2 * wallTaperPerp * wallTaperPerp));
      const wAlong = wdyAbs <= wallHalfLen
        ? 1
        : Math.exp(-((wdyAbs - wallHalfLen) ** 2) / (2 * wallEndSigma * wallEndSigma));
      const wallH = wPerp * wAlong;
      // Mountain.
      const mdx = px - mtnCenterPx.x;
      const mdy = py - mtnCenterPx.y;
      const mtnH = Math.exp(-(mdx * mdx + mdy * mdy) / (2 * mtnSigma * mtnSigma));
      return Math.max(wallH, mtnH);
    }

    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const pos = offsetToPixel(c, r, HEX_PIXEL_SIZE);
        const idx = r * width + c;
        const tile = world.tiles[idx];
        // Centre height drives the simulation (terrain force gradient).
        const centreH = sampleHeight(pos.x, pos.y);
        if (centreH > tile.height) tile.height = centreH;
        // Corner heights drive the renderer for a sharp visual edge.
        const corners = hexCorners(pos.x, pos.y, HEX_PIXEL_SIZE);
        const ch = tile.cornerHeights ?? new Float32Array(6);
        for (let i = 0; i < 6; i++) {
          const sampled = sampleHeight(corners[i].x, corners[i].y);
          if (sampled > ch[i]) ch[i] = sampled;
        }
        tile.cornerHeights = ch;
      }
    }
  }

  airFlow = new AirFlowSimulation(world);
  airFlow.setBaseline(config.windDensityBaseline);
  {
    const { width, height } = gridDimensions(config.hexCount);
    const cx = Math.floor(width / 2);
    const cy = Math.floor(height / 2);
    const centerPx = offsetToPixel(cx, cy, HEX_PIXEL_SIZE);
    // Radius in pixel space corresponding to 5 hex hops along an axis.
    const radiusPx = 5 * Math.sqrt(3) * HEX_PIXEL_SIZE;
    const placed = new Set<number>();
    for (let i = 0; i < 12; i++) {
      const angle = (i * Math.PI) / 6; // 0°, 30°, 60°, …
      const tx = centerPx.x + radiusPx * Math.cos(angle);
      const ty = centerPx.y + radiusPx * Math.sin(angle);
      const cell = pixelToOffset(tx, ty, HEX_PIXEL_SIZE);
      if (cell.col < 0 || cell.col >= width || cell.row < 0 || cell.row >= height) continue;
      const idx = cell.row * width + cell.col;
      if (placed.has(idx)) continue;
      placed.add(idx);
      addSource({
        col: cell.col,
        row: cell.row,
        vx: Math.cos(angle) * config.placeSpeed,
        vy: Math.sin(angle) * config.placeSpeed,
        density: config.placeDensity,
        duration: config.placeOnTime,
        period: config.placePeriod,
      });
    }
  }

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
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      // Branch on the *placement mode* chosen before the drag began. The
      // mode also changes how strength is sourced: continuous uses drag
      // length (clamped to maxSpeed); burst takes its strength from the
      // slider, so the drag only sets direction. The source's burst params
      // (duration, period, density) are snapshotted here and never change.
      if (placementMode.value === 'sink') {
        // Sinks have no direction or strength; the drag is just visual
        // feedback while picking the cell. Rate comes from the slider.
        addSink({ col: cell.col, row: cell.row, rate: config.sinkRate });
      } else if (placementMode.value === 'burst') {
        const mag = Math.hypot(dx, dy);
        if (mag < 1e-3) { mode = 'idle'; sourceDrag.value = null; return; }
        const speed = config.placeSpeed;
        const vx = (dx / mag) * speed;
        const vy = (dy / mag) * speed;
        addSource({
          col: cell.col,
          row: cell.row,
          vx,
          vy,
          density: config.placeDensity,
          duration: config.placeOnTime,
          period: config.placePeriod,
        });
      } else {
        const sx = dx * SOURCE_DRAG_SCALE;
        const sy = dy * SOURCE_DRAG_SCALE;
        const mag = Math.hypot(sx, sy);
        const cap = config.windMaxSpeed;
        const k = mag > cap ? cap / mag : 1;
        // Continuous sources inject density too — same value as bursts.
        // Velocity without an air parcel makes no physical sense and was
        // producing pure-velocity blue fans that the V↔ρ coupling can't
        // make peace with. An always-on source is just a burst with
        // duration = period = Infinity; both flavours deserve density.
        addSource({
          col: cell.col,
          row: cell.row,
          vx: sx * k,
          vy: sy * k,
          density: config.placeDensity,
        });
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

// Baseline slider: refills density everywhere when the user moves it.
// User opts in by touching the slider; mid-experiment they can leave it.
watch(
  () => config.windDensityBaseline,
  (v) => airFlow?.setBaseline(v),
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
