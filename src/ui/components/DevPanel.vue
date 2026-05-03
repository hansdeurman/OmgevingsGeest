<script setup lang="ts">
import { computed } from 'vue';
import { parameterDefs, type ParamMeta } from '../../config/parameters';
import { placingSource, windSources, clearSources } from '../../airflow';
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
</script>

<template>
  <aside class="dev">
    <header>
      <h2>Developer</h2>
      <p>Tweak. Watch. Repeat.</p>
    </header>

    <section v-for="[group, params] in groups" :key="group">
      <h3>{{ group }}</h3>
      <ParameterControl v-for="p in params" :key="p.key" :meta="p" />
    </section>

    <section>
      <h3>Sources</h3>
      <div class="srow">
        <span class="count">
          {{ windSources.length }} placed
        </span>
        <span v-if="placingSource" class="hint">drag on map to place</span>
      </div>
      <div class="srow buttons">
        <button
          type="button"
          :class="{ primary: !placingSource, danger: placingSource }"
          @click="togglePlacing"
        >
          {{ placingSource ? 'Cancel' : 'Add Source' }}
        </button>
        <button
          type="button"
          class="ghost"
          :disabled="!windSources.length"
          @click="clearSources"
        >
          Clear
        </button>
      </div>
      <p class="tip">Tip: hold Shift and drag on the map for the same effect.</p>
    </section>
  </aside>
</template>

<style scoped>
.dev { padding: 16px; font-size: 12px; }
header h2 { margin: 0 0 4px; font-size: 14px; letter-spacing: 0.04em; text-transform: uppercase; }
header p { margin: 0 0 16px; color: #6b6b78; }
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
