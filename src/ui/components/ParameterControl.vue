<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { config, type ParamMeta } from '../../config/parameters';

const props = defineProps<{ meta: ParamMeta }>();

const value = computed({
  get: () => config[props.meta.key],
  set: (v) => {
    config[props.meta.key] = v;
  },
});

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

const decimals = computed(() => decimalsForStep(props.meta.step));

function clamp(v: number): number {
  let out = v;
  if (props.meta.type === 'int') out = Math.round(out);
  if (props.meta.min !== undefined) out = Math.max(props.meta.min, out);
  if (props.meta.max !== undefined) out = Math.min(props.meta.max, out);
  return out;
}

function setNumber(v: number) {
  if (Number.isNaN(v) || !Number.isFinite(v)) return;
  config[props.meta.key] = clamp(v);
}

function onSlider(e: Event) {
  setNumber(+(e.target as HTMLInputElement).value);
}

// The number-input keeps its own draft string while the user is typing so
// invalid intermediate states (empty, "-", "1.") don't immediately rewrite
// `config`. We commit on blur or Enter. External writes to config (via the
// slider or buttons) reset the draft.
const draft = ref(formatValue());

function formatValue(): string {
  const v = value.value;
  if (typeof v === 'number') {
    return props.meta.type === 'int' ? v.toString() : v.toFixed(decimals.value);
  }
  return String(v);
}

watch(value, () => {
  draft.value = formatValue();
});

function commitDraft() {
  const parsed = parseFloat(draft.value);
  if (!Number.isNaN(parsed)) setNumber(parsed);
  draft.value = formatValue();
}

function step(direction: 1 | -1) {
  const s = props.meta.step ?? 1;
  const cur = typeof value.value === 'number' ? value.value : 0;
  setNumber(cur + direction * s);
}
</script>

<template>
  <div class="row" :class="{ 'row--bool': meta.type === 'boolean' }">
    <label :for="meta.key">{{ meta.label }}</label>

    <template v-if="meta.type === 'boolean'">
      <input :id="meta.key" type="checkbox" v-model="value as unknown as boolean" />
    </template>

    <template v-else>
      <button
        type="button"
        class="nudge"
        :aria-label="`Decrease ${meta.label}`"
        :title="`-${meta.step ?? 1}`"
        @click="step(-1)"
      >−</button>
      <input
        :id="meta.key"
        type="range"
        :min="meta.min"
        :max="meta.max"
        :step="meta.step"
        :value="value"
        @input="onSlider"
      />
      <button
        type="button"
        class="nudge"
        :aria-label="`Increase ${meta.label}`"
        :title="`+${meta.step ?? 1}`"
        @click="step(1)"
      >+</button>
      <input
        class="num"
        type="number"
        inputmode="decimal"
        :min="meta.min"
        :max="meta.max"
        :step="meta.step"
        v-model="draft"
        @change="commitDraft"
        @blur="commitDraft"
        @keydown.enter="commitDraft"
      />
    </template>
  </div>
</template>

<style scoped>
.row {
  display: grid;
  grid-template-columns: 80px 18px 1fr 18px 56px;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
}
.row--bool {
  grid-template-columns: 80px 1fr;
}
label { color: #c2c2cc; }
input[type="range"] { width: 100%; accent-color: #6a8cff; min-width: 0; }
input[type="checkbox"] { justify-self: start; accent-color: #6a8cff; }

.num {
  width: 100%;
  min-width: 0;
  font: inherit;
  font-variant-numeric: tabular-nums;
  text-align: right;
  background: #0e0e14;
  color: #e6e6ea;
  border: 1px solid #1f1f28;
  border-radius: 4px;
  padding: 2px 4px;
}
.num:focus {
  outline: none;
  border-color: #6a8cff;
}
.num::-webkit-outer-spin-button,
.num::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.num { -moz-appearance: textfield; }

.nudge {
  width: 18px;
  height: 18px;
  padding: 0;
  font: 600 13px/1 ui-sans-serif, system-ui, sans-serif;
  color: #c2c2cc;
  background: transparent;
  border: 1px solid #1f1f28;
  border-radius: 3px;
  cursor: pointer;
  display: grid;
  place-items: center;
}
.nudge:hover { background: #1f1f28; color: #fff; }
.nudge:active { background: #2a2a36; }
</style>
