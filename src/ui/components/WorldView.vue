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
import { gridPixelBounds, pixelToOffset, offsetToPixel } from '../../math/hex';
import { applyScenario, currentScenarioId } from '../../scenarios';
import {
  avatar,
  avatarMode,
  centreAvatar,
  placeAvatar,
  projectiles,
  fireProjectile,
  stepProjectiles,
  clearProjectiles,
  snapFireDir,
} from '../../game/avatar';
import type { SwipeAim } from '../../rendering/canvas/avatarOverlay';

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

/**
 * In-progress firing swipe. Tracked in *screen* pixels: the deadzone is a
 * feel threshold the user experiences on screen, so it shouldn't change
 * meaning when they zoom. The camera has no rotation, so a screen-space
 * direction is also the world-space direction.
 */
const swipeAim = ref<SwipeAim | null>(null);

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
  // A rebuilt grid may be a different size, so re-park the avatar and drop
  // any shots that were flying over the old map.
  centreAvatar(world.width, world.height);
  clearProjectiles();
}

function frame(now: number) {
  // Frame dt is multiplied by Time Scale so the user can slow the whole
  // simulation down (or speed it up) without altering the dynamics —
  // every per-second rate (damping, advection, diffusion, etc.) scales
  // uniformly because they all read this same dt.
  const rawDt = lastFrameTime ? Math.min(0.1, (now - lastFrameTime) / 1000) : 0;
  const dt = rawDt * Math.max(0, config.simTimeScale);
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
        terrainHorizon: config.windTerrainHorizon,
        terrainDeflect: config.windTerrainDeflect,
        downhillRatio: config.windDownhillRatio,
        overcomeFactor: config.windOvercomeFactor,
        maxSpeed: config.windMaxSpeed,
        advection: config.windAdvection,
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
    if (dt > 0 && projectiles.length) {
      const b = gridPixelBounds(world.width, world.height, HEX_PIXEL_SIZE);
      stepProjectiles(dt, b.x, b.y);
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
      avatar,
      projectiles,
      swipeAim: config.avatarShowGuide ? (swipeAim.value ?? undefined) : undefined,
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

  // Boot the page with the currently-selected test scenario. The dropdown
  // in the dev panel can swap to another one at any time; switching runs
  // applyScenario() which resets terrain + sources before painting the
  // new setup.
  if (airFlow) applyScenario(currentScenarioId.value, world, airFlow);

  resizeObs = new ResizeObserver(() => {
    renderer.resize(host.clientWidth, host.clientHeight);
  });
  resizeObs.observe(host);

  // Pointer state. Pointer events (rather than mouse events) so a finger
  // swipe on a touch screen goes down exactly the same path as a mouse
  // drag — which is the whole point of a "does this feel good" test rig.
  //
  // Drag modes, decided on pointerdown:
  //   - pan:    middle button, or ctrl/⌘ held. Always available.
  //   - source: placingSource is on, OR shift is held.
  //   - swipe:  avatar mode is on (the default) — fires a projectile.
  //   - pan:    fallback when avatar mode is off.
  let mode: 'idle' | 'pan' | 'source' | 'swipe' = 'idle';
  let panLastX = 0;
  let panLastY = 0;
  let swipeStartX = 0;
  let swipeStartY = 0;
  let activePointer: number | null = null;

  /** Re-evaluate the snapped direction for the current drag vector. */
  function updateSwipe(clientX: number, clientY: number) {
    const dx = clientX - swipeStartX;
    const dy = clientY - swipeStartY;
    const past = Math.hypot(dx, dy) >= config.avatarSwipeDeadzone;
    swipeAim.value = { dx, dy, dirIndex: past ? snapFireDir(dx, dy) : -1 };
  }

  host.addEventListener('pointerdown', (e) => {
    // One gesture at a time: ignore extra fingers mid-drag.
    if (activePointer !== null) return;
    activePointer = e.pointerId;
    host.setPointerCapture(e.pointerId);

    const wantsPan = e.button === 1 || e.ctrlKey || e.metaKey;
    if (!wantsPan && (placingSource.value || e.shiftKey)) {
      mode = 'source';
      const w = clientToWorld(host, e.clientX, e.clientY);
      // Snap source position to the centre of the picked hex.
      const cell = pixelToOffset(w.x, w.y, HEX_PIXEL_SIZE);
      const snapped = offsetToPixel(cell.col, cell.row, HEX_PIXEL_SIZE);
      sourceDrag.value = { start: snapped, end: w };
      e.preventDefault();
    } else if (!wantsPan && avatarMode.value) {
      mode = 'swipe';
      swipeStartX = e.clientX;
      swipeStartY = e.clientY;
      updateSwipe(e.clientX, e.clientY);
      e.preventDefault();
    } else {
      mode = 'pan';
      panLastX = e.clientX;
      panLastY = e.clientY;
    }
  });

  host.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activePointer) return;
    if (mode === 'pan') {
      camera.panBy(e.clientX - panLastX, e.clientY - panLastY);
      panLastX = e.clientX;
      panLastY = e.clientY;
    } else if (mode === 'source' && sourceDrag.value) {
      sourceDrag.value = {
        start: sourceDrag.value.start,
        end: clientToWorld(host, e.clientX, e.clientY),
      };
    } else if (mode === 'swipe') {
      updateSwipe(e.clientX, e.clientY);
    }
  });

  host.addEventListener('pointercancel', (e) => {
    if (e.pointerId !== activePointer) return;
    activePointer = null;
    mode = 'idle';
    sourceDrag.value = null;
    swipeAim.value = null;
  });

  host.addEventListener('pointerup', (e) => {
    if (e.pointerId !== activePointer) return;
    activePointer = null;

    if (mode === 'swipe') {
      const dx = e.clientX - swipeStartX;
      const dy = e.clientY - swipeStartY;
      if (Math.hypot(dx, dy) >= config.avatarSwipeDeadzone) {
        // Past the deadzone: fire along the snapped direction, from the
        // avatar's hex centre. Swipe length sets direction only — power is
        // fixed so the gesture stays a pure aiming control.
        const dir = snapFireDir(dx, dy);
        const origin = offsetToPixel(avatar.col, avatar.row, HEX_PIXEL_SIZE);
        fireProjectile(dir, origin.x, origin.y, config.avatarShotSpeed, config.avatarShotRange);
      } else {
        // Tap: reposition the avatar so shots can be tried from anywhere.
        const w = clientToWorld(host, e.clientX, e.clientY);
        const cell = pixelToOffset(w.x, w.y, HEX_PIXEL_SIZE);
        if (cell.col >= 0 && cell.col < world.width && cell.row >= 0 && cell.row < world.height) {
          placeAvatar(cell.col, cell.row);
        }
      }
      swipeAim.value = null;
      mode = 'idle';
      e.preventDefault();
      return;
    }

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

// Scenario dropdown: re-apply when the user picks a different setup.
watch(
  () => currentScenarioId.value,
  (id) => {
    if (airFlow) applyScenario(id, world, airFlow);
    clearProjectiles();
  },
);
</script>

<template>
  <div
    ref="hostRef"
    class="host"
    :class="{ placing: placingSource, aiming: avatarMode && !placingSource }"
  ></div>
</template>

<style scoped>
.host {
  width: 100%;
  height: 100%;
  cursor: grab;
  /* Pointer events only reach us if the browser doesn't claim the gesture
     for scrolling/zooming first — required for touch swipes to work. */
  touch-action: none;
}
.host:active { cursor: grabbing; }
.host.aiming { cursor: pointer; }
.host.placing { cursor: crosshair; }
.host.placing:active { cursor: crosshair; }
</style>
