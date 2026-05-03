<script setup lang="ts">
import { computed } from 'vue';
import { config, type ParamMeta } from '../../config/parameters';

const props = defineProps<{ meta: ParamMeta }>();

const value = computed({
  get: () => config[props.meta.key],
  set: (v) => {
    config[props.meta.key] = v;
  },
});

function onRange(e: Event) {
  const v = +(e.target as HTMLInputElement).value;
  config[props.meta.key] = props.meta.type === 'int' ? Math.round(v) : v;
}

const display = computed(() => {
  const v = value.value;
  if (typeof v === 'number') {
    return props.meta.type === 'int' ? v.toString() : v.toFixed(3);
  }
  return String(v);
});
</script>

<template>
  <div class="row">
    <label :for="meta.key">{{ meta.label }}</label>

    <template v-if="meta.type === 'boolean'">
      <input :id="meta.key" type="checkbox" v-model="value as unknown as boolean" />
    </template>

    <template v-else>
      <input
        :id="meta.key"
        type="range"
        :min="meta.min"
        :max="meta.max"
        :step="meta.step"
        :value="value"
        @input="onRange"
      />
      <span class="val">{{ display }}</span>
    </template>
  </div>
</template>

<style scoped>
.row {
  display: grid;
  grid-template-columns: 90px 1fr 56px;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
label { color: #c2c2cc; }
.val {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: #8a8a99;
}
input[type="range"] { width: 100%; accent-color: #6a8cff; }
input[type="checkbox"] { justify-self: start; accent-color: #6a8cff; }
</style>
