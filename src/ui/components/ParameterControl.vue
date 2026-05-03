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

function decimalsForStep(step: number | undefined): number {
  if (!step || step >= 1) return 0;
  const s = step.toString();
  // Handle scientific notation like 1e-3.
  if (s.includes('e') || s.includes('E')) {
    const [mantissa, exp] = s.toLowerCase().split('e');
    const baseDecimals = (mantissa.split('.')[1] ?? '').length;
    return Math.max(0, baseDecimals - parseInt(exp, 10));
  }
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

const display = computed(() => {
  const v = value.value;
  if (typeof v === 'number') {
    if (props.meta.type === 'int') return v.toString();
    return v.toFixed(decimalsForStep(props.meta.step));
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
