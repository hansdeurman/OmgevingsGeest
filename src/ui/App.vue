<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import WorldView from './components/WorldView.vue';
import DevPanel from './components/DevPanel.vue';
import BuildBadge from './components/BuildBadge.vue';

const PANEL_STORAGE_KEY = 'omgevingsgeest:panel-open';

function readStored(): boolean | null {
  try {
    const v = localStorage.getItem(PANEL_STORAGE_KEY);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}

const open = ref(true);

onMounted(() => {
  const stored = readStored();
  if (stored !== null) {
    open.value = stored;
  } else if (window.innerWidth < 720) {
    // First visit on a phone: default to closed so the world isn't covered.
    open.value = false;
  }
});

watch(open, (v) => {
  try {
    localStorage.setItem(PANEL_STORAGE_KEY, v ? '1' : '0');
  } catch {
    /* localStorage unavailable (private mode, etc.) — ignore. */
  }
});
</script>

<template>
  <div class="app">
    <div class="world-wrap">
      <WorldView class="world" />
      <BuildBadge />
    </div>

    <aside class="panel" :class="{ closed: !open }" aria-label="Developer panel">
      <DevPanel />
    </aside>

    <button
      class="toggle"
      :class="{ pushed: open }"
      type="button"
      :aria-expanded="open"
      :aria-label="open ? 'Hide settings' : 'Show settings'"
      :title="open ? 'Hide settings' : 'Show settings'"
      @click="open = !open"
    >
      <span class="arrow" :class="{ flip: !open }">›</span>
    </button>
  </div>
</template>

<style>
:root {
  color-scheme: dark;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}

html, body, #app {
  height: 100%;
  margin: 0;
  background: #0a0a10;
  color: #e6e6ea;
  overflow: hidden;
}

.app {
  position: relative;
  width: 100%;
  height: 100vh;
}

.world-wrap { position: absolute; inset: 0; overflow: hidden; }
.world { position: relative; overflow: hidden; height: 100%; }

/* Panel slides in from the right. When closed it sits 100% off-screen
   (no sliver showing) and only the toggle button hints it exists. */
.panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 320px;
  background: #14141c;
  border-left: 1px solid #1f1f28;
  overflow: auto;
  transform: translateX(0);
  transition: transform 0.22s ease;
  z-index: 4;
}
.panel.closed { transform: translateX(100%); }

/* Toggle is its own floating element. It animates between right:0 (closed)
   and right:320px (open) so it always sits flush against the panel's edge. */
.toggle {
  position: absolute;
  top: 50%;
  right: 0;
  width: 32px;
  height: 64px;
  display: grid;
  place-items: center;
  background: rgba(20, 20, 28, 0.85);
  border: 1px solid #1f1f28;
  border-right: none;
  border-radius: 8px 0 0 8px;
  color: #c2c2cc;
  cursor: pointer;
  font: 600 20px/1 ui-sans-serif, system-ui, sans-serif;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  transform: translateY(-50%) translateX(0);
  transition: transform 0.22s ease, background 0.12s ease, color 0.12s ease;
  z-index: 5;
}
.toggle.pushed { transform: translateY(-50%) translateX(-320px); }
.toggle:hover { background: rgba(34, 34, 46, 0.95); color: #fff; }
.toggle:focus-visible { outline: 2px solid #6a8cff; outline-offset: 2px; }

.arrow {
  display: inline-block;
  transition: transform 0.22s ease;
  transform: rotate(0deg);
}
.arrow.flip { transform: rotate(180deg); }
</style>
