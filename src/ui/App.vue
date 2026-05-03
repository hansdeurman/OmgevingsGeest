<script setup lang="ts">
import WorldView from './components/WorldView.vue';
import DevPanel from './components/DevPanel.vue';
</script>

<template>
  <div class="app">
    <WorldView class="world" />
    <DevPanel class="panel" />
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
  display: grid;
  grid-template-columns: 1fr 320px;
  height: 100vh;
}

.world { position: relative; overflow: hidden; }
.panel { border-left: 1px solid #1f1f28; background: #14141c; overflow: auto; }
</style>
