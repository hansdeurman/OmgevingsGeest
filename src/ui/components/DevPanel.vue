<script setup lang="ts">
import { computed } from 'vue';
import { parameterDefs, type ParamMeta } from '../../config/parameters';
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
</style>
