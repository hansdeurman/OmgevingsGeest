<script setup lang="ts">
import { onMounted, ref } from 'vue';
import WorldView from './components/WorldView.vue';
import DevPanel from './components/DevPanel.vue';
import BuildBadge from './components/BuildBadge.vue';

const open = ref(true);

onMounted(() => {
  // Default to closed on narrow screens (phones) so the world isn't covered.
  if (window.innerWidth < 720) open.value = false;
});
</script>

<template>
  <div class="app">
    <div class="world-wrap">
      <WorldView class="world" />
      <BuildBadge />
    </div>

    <aside class="panel-wrap" :class="{ closed: !open }" aria-label="Developer panel">
      <button
        class="toggle"
        type="button"
        :aria-expanded="open"
        :aria-label="open ? 'Hide settings' : 'Show settings'"
        :title="open ? 'Hide settings' : 'Show settings'"
        @click="open = !open"
      >
        <span class="arrow" :class="{ flip: !open }">›</span>
      </button>
      <DevPanel class="panel" />
    </aside>
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

.panel-wrap {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: stretch;
  pointer-events: none;
  transform: translateX(0);
  transition: transform 0.22s ease;
  z-index: 5;
}
.panel-wrap.closed { transform: translateX(320px); }

.toggle {
  pointer-events: auto;
  align-self: center;
  width: 28px;
  height: 64px;
  display: grid;
  place-items: center;
  background: rgba(20, 20, 28, 0.85);
  border: 1px solid #1f1f28;
  border-right: none;
  border-radius: 8px 0 0 8px;
  color: #c2c2cc;
  cursor: pointer;
  font: 600 18px/1 ui-sans-serif, system-ui, sans-serif;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  transition: background 0.12s ease, color 0.12s ease;
}
.toggle:hover { background: rgba(34, 34, 46, 0.95); color: #fff; }
.toggle:focus-visible { outline: 2px solid #6a8cff; outline-offset: 2px; }

.arrow {
  display: inline-block;
  transition: transform 0.22s ease;
  transform: rotate(0deg);
}
.arrow.flip { transform: rotate(180deg); }

.panel {
  pointer-events: auto;
  width: 320px;
  border-left: 1px solid #1f1f28;
  background: #14141c;
  overflow: auto;
}
</style>
