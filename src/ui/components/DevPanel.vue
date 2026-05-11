<script setup lang="ts">
import { computed, ref } from 'vue';
import { config, parameterDefs, gridDimensions, type ParamMeta } from '../../config/parameters';
import {
  placingSource,
  placementMode,
  windSources,
  windSinks,
  clearSources,
  clearSinks,
  removeSource,
  removeSink,
  highlightedSourceIdx,
  highlightedSinkIdx,
  fireBurst,
  requestFieldClear,
} from '../../airflow';
import { NEIGHBOUR_DIRS } from '../../math/hex';
import { SCENARIOS, currentScenarioId } from '../../scenarios';
import ParameterControl from './ParameterControl.vue';

const groups = computed(() => {
  const map = new Map<string, ParamMeta[]>();
  for (const p of parameterDefs) {
    const arr = map.get(p.group) ?? [];
    arr.push(p);
    map.set(p.group, arr);
  }
  return Array.from(map.entries());
});

function togglePlacing() {
  placingSource.value = !placingSource.value;
}

/**
 * Six hex directions in the order matching NEIGHBOUR_DIRS:
 *   [E, NE, NW, W, SW, SE]
 *
 * The user asked for "60 degrees in the hex map" — every entry here is one
 * of the six 60° axes, so any of these is a valid axis-aligned test.
 */
const burstDirections: ReadonlyArray<{ label: string; index: number }> = [
  { label: 'E',  index: 0 },
  { label: 'NE', index: 1 },
  { label: 'NW', index: 2 },
  { label: 'W',  index: 3 },
  { label: 'SW', index: 4 },
  { label: 'SE', index: 5 },
];

/**
 * Fire a one-frame burst at the map centre, pointing along hex direction `i`.
 * Always clears the field first so each test runs in isolation — that's the
 * whole point of this tool.
 */
function fireDirectionalBurst(i: number) {
  const { width, height } = gridDimensions(config.hexCount);
  const col = (width / 2) | 0;
  const row = (height / 2) | 0;
  const d = NEIGHBOUR_DIRS[i];
  requestFieldClear.value = true;
  fireBurst({
    col,
    row,
    vx: d.x * config.placeSpeed,
    vy: d.y * config.placeSpeed,
    density: config.placeDensity,
  });
}

function clearField() {
  requestFieldClear.value = true;
}

/**
 * Snapshot the entire reactive config plus build identity into JSON and
 * copy it to the clipboard. The build SHA is the *git commit* the running
 * bundle was built from — same value the BuildBadge shows — so a saved
 * snapshot is reproducible by checking out that commit and pasting back.
 */
const copyState = ref<'idle' | 'ok' | 'fail'>('idle');

async function copySettings() {
  const payload = {
    buildSha: __BUILD_SHA__,
    buildTime: __BUILD_TIME__,
    savedAt: new Date().toISOString(),
    config: { ...config },
  };
  const json = JSON.stringify(payload, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    copyState.value = 'ok';
  } catch {
    // Last-ditch fallback when clipboard API is blocked (file://, etc.).
    try {
      const ta = document.createElement('textarea');
      ta.value = json;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      copyState.value = 'ok';
    } catch {
      copyState.value = 'fail';
    }
  }
  setTimeout(() => { copyState.value = 'idle'; }, 1500);
}
</script>

<template>
  <aside class="dev">
    <header>
      <h2>Developer</h2>
      <p>Tweak. Watch. Repeat.</p>
      <button
        type="button"
        class="save"
        :class="{ ok: copyState === 'ok', fail: copyState === 'fail' }"
        @click="copySettings"
        :title="'Copy build SHA + all config to clipboard as JSON'"
      >
        {{ copyState === 'ok' ? 'Copied!' : copyState === 'fail' ? 'Copy failed' : 'Save Settings (JSON)' }}
      </button>
      <!-- Scenario picker. Switching re-applies terrain heights / corner
           heights and replaces any user-placed sources with the new
           scenario's starter set. -->
      <label class="scenario">
        <span class="scenario-label">Scenario</span>
        <select v-model="currentScenarioId">
          <option v-for="s in SCENARIOS" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </label>
    </header>

    <section v-for="[group, params] in groups" :key="group">
      <h3>{{ group }}</h3>
      <ParameterControl v-for="p in params" :key="p.key" :meta="p" />
      <!-- Direction grid lives inside the Placement group (kept separate
           from generic ParameterControls because it isn't a single value). -->
      <template v-if="group === 'Placement'">
        <div class="burst-grid">
          <button
            v-for="d in burstDirections"
            :key="d.index"
            type="button"
            class="primary"
            :title="`Fire 1-frame burst pointing ${d.label} from map centre`"
            @click="fireDirectionalBurst(d.index)"
          >
            {{ d.label }}
          </button>
        </div>
        <div class="srow buttons">
          <button type="button" class="ghost" @click="clearField">Clear Field</button>
        </div>
        <p class="tip">
          Fires a one-frame impulse from the map centre along one of the six 60° hex axes.
          Watch the parcel travel: amplitude decays, density follows, a sliver disperses sideways.
        </p>
      </template>
    </section>

    <section>
      <h3>Sources &amp; Sinks</h3>
      <div class="srow">
        <span class="count">
          {{ windSources.length }} src · {{ windSinks.length }} sink
        </span>
        <span v-if="placingSource" class="hint">drag on map to place</span>
      </div>
      <!-- Mode is locked in BEFORE the drag begins; once a source/sink is
           placed, its nature is fixed. Disabled mid-drag so the user can't
           change horses halfway. -->
      <div class="srow mode" role="radiogroup" aria-label="Placement mode">
        <label>
          <input
            type="radio"
            v-model="placementMode"
            value="continuous"
            :disabled="placingSource"
          />
          Continuous
        </label>
        <label>
          <input
            type="radio"
            v-model="placementMode"
            value="burst"
            :disabled="placingSource"
          />
          Burst
        </label>
        <label>
          <input
            type="radio"
            v-model="placementMode"
            value="sink"
            :disabled="placingSource"
          />
          Sink
        </label>
      </div>
      <div class="srow buttons">
        <button
          type="button"
          :class="{ primary: !placingSource, danger: placingSource }"
          @click="togglePlacing"
        >
          {{ placingSource
            ? 'Cancel'
            : placementMode === 'sink' ? 'Add Sink'
            : placementMode === 'burst' ? 'Add Burst'
            : 'Add Source' }}
        </button>
        <button
          type="button"
          class="ghost"
          :disabled="!windSources.length"
          @click="clearSources"
        >
          Clear src
        </button>
        <button
          type="button"
          class="ghost"
          :disabled="!windSinks.length"
          @click="clearSinks"
        >
          Clear sink
        </button>
      </div>
      <p class="tip">
        Tip: hold Shift and drag on the map for the same effect.
        <span v-if="placementMode === 'burst'">
          A drag-placed burst pulses on its own duty cycle.
        </span>
        <span v-else-if="placementMode === 'sink'">
          Sinks drain density at the rate from the slider — pair manually with a source by matching rates.
        </span>
      </p>

      <!-- Existing-source listing. Each source's settings are SNAPSHOTTED at
           placement; changing the sliders above does not retro-edit them.
           This list shows what each one is actually doing right now. -->
      <ul v-if="windSources.length" class="src-list">
        <li
          v-for="(s, i) in windSources"
          :key="i"
          @mouseenter="highlightedSourceIdx = i"
          @mouseleave="highlightedSourceIdx = -1"
        >
          <span class="src-pos">({{ s.col }}, {{ s.row }})</span>
          <span class="src-vec">v={{ Math.hypot(s.vx, s.vy).toFixed(1) }}</span>
          <span class="src-dens">ρ={{ s.density.toFixed(1) }}</span>
          <span class="src-cycle" v-if="Number.isFinite(s.duration) && Number.isFinite(s.period)">
            {{ s.duration.toFixed(2) }}/{{ s.period.toFixed(2) }}s
          </span>
          <span class="src-cycle" v-else>continuous</span>
          <button
            type="button"
            class="src-remove"
            :title="`Remove source at (${s.col}, ${s.row})`"
            @click="removeSource(i)"
          >×</button>
        </li>
      </ul>
      <ul v-if="windSinks.length" class="src-list">
        <li
          v-for="(s, i) in windSinks"
          :key="`sink-${i}`"
          class="sink"
          @mouseenter="highlightedSinkIdx = i"
          @mouseleave="highlightedSinkIdx = -1"
        >
          <span class="src-pos">({{ s.col }}, {{ s.row }})</span>
          <span class="src-dens">drain {{ s.rate.toFixed(1) }}/s</span>
          <button
            type="button"
            class="src-remove"
            :title="`Remove sink at (${s.col}, ${s.row})`"
            @click="removeSink(i)"
          >×</button>
        </li>
      </ul>
    </section>
  </aside>
</template>

<style scoped>
.dev { padding: 16px; font-size: 12px; }
header h2 { margin: 0 0 4px; font-size: 14px; letter-spacing: 0.04em; text-transform: uppercase; }
header p { margin: 0 0 8px; color: #6b6b78; }
header .save {
  display: block;
  width: 100%;
  margin: 0 0 16px;
  padding: 6px 10px;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border-radius: 4px;
  background: transparent;
  border: 1px solid #2a2a36;
  color: #c2c2cc;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}
header .save:hover { background: #1f1f28; color: #fff; }
header .save.ok { background: #2a4a32; border-color: #5fbd7c; color: #c0f5cc; }
header .save.fail { background: #4a2a2a; border-color: #cc5566; color: #ff8090; }

header .scenario {
  display: grid;
  grid-template-columns: 60px 1fr;
  align-items: center;
  gap: 8px;
  margin: 0 0 16px;
}
header .scenario-label {
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #8a8a99;
}
header .scenario select {
  width: 100%;
  padding: 5px 8px;
  font: inherit;
  font-size: 12px;
  background: #0e0e14;
  color: #e6e6ea;
  border: 1px solid #2a2a36;
  border-radius: 4px;
  cursor: pointer;
}
header .scenario select:focus {
  outline: none;
  border-color: #6a8cff;
}
section { margin-bottom: 18px; }
h3 {
  margin: 0 0 8px;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #8a8a99;
  border-bottom: 1px solid #1f1f28;
  padding-bottom: 4px;
}

.srow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  gap: 8px;
}
.srow.buttons { gap: 6px; }

.burst-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin: 8px 0;
}
.burst-grid button { padding: 6px 0; }

.srow.mode {
  justify-content: flex-start;
  gap: 14px;
  color: #c2c2cc;
}
.srow.mode label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.srow.mode input[type="radio"] {
  accent-color: #6a8cff;
  margin: 0;
}
.srow.mode label:has(input:disabled) { opacity: 0.5; }

.src-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: #c2c2cc;
  border-top: 1px solid #1f1f28;
  padding-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 180px;
  overflow-y: auto;
}
.src-list li {
  display: grid;
  grid-template-columns: auto auto auto 1fr 18px;
  gap: 6px;
  padding: 2px 4px;
  border-radius: 3px;
  background: rgba(106, 140, 255, 0.08);
  align-items: center;
}
.src-list li.sink {
  grid-template-columns: auto 1fr 18px;
  background: rgba(204, 85, 102, 0.12);
}
.src-list .src-pos { color: #8a8a99; }
.src-list .src-vec { color: #88ccff; }
.src-list .src-dens { color: #ffaa66; }
.src-list .src-cycle { color: #8a8a99; text-align: right; }
.src-list .src-remove {
  width: 18px;
  height: 18px;
  padding: 0;
  font: 600 13px/1 ui-sans-serif, system-ui, sans-serif;
  color: #c2c2cc;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  cursor: pointer;
  display: grid;
  place-items: center;
}
.src-list .src-remove:hover {
  background: rgba(204, 85, 102, 0.25);
  color: #ff8090;
  border-color: #cc5566;
}
.count { color: #c2c2cc; }
.hint { color: #6a8cff; font-style: italic; font-size: 11px; }
.tip { margin: 6px 0 0; color: #6b6b78; font-size: 11px; line-height: 1.4; }

button {
  flex: 1;
  padding: 6px 10px;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}
button:disabled { opacity: 0.4; cursor: not-allowed; }
button.primary {
  background: #6a8cff;
  border: 1px solid #6a8cff;
  color: #0a0a10;
}
button.primary:hover:not(:disabled) { background: #88a4ff; border-color: #88a4ff; }
button.danger {
  background: transparent;
  border: 1px solid #cc5566;
  color: #ff8090;
}
button.danger:hover:not(:disabled) { background: rgba(204, 85, 102, 0.15); }
button.ghost {
  background: transparent;
  border: 1px solid #1f1f28;
  color: #c2c2cc;
}
button.ghost:hover:not(:disabled) { background: #1f1f28; }
</style>
