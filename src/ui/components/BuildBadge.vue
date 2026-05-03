<script setup lang="ts">
import { computed, ref } from 'vue';

const expanded = ref(false);

const sha = __BUILD_SHA__;
const time = __BUILD_TIME__;

const shortSha = computed(() => (sha === 'dev' ? 'dev' : sha.slice(0, 7)));

const timeLabel = computed(() => {
  if (!time) return '';
  const d = new Date(time);
  if (Number.isNaN(d.getTime())) return time;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
});

const repoUrl = computed(() =>
  sha === 'dev' ? null : `https://github.com/hansdeurman/OmgevingsGeest/commit/${sha}`,
);

function openCommit() {
  if (repoUrl.value) window.open(repoUrl.value, '_blank', 'noopener');
}
</script>

<template>
  <a
    class="badge"
    :class="{ expanded }"
    :href="repoUrl ?? undefined"
    :target="repoUrl ? '_blank' : undefined"
    rel="noopener"
    @click.prevent="expanded = !expanded"
    @dblclick="openCommit"
    :title="`Build ${sha}\n${time}\n(tap to expand, double-tap to open commit)`"
  >
    <span class="dot" />
    <span class="label">build</span>
    <span class="sha">{{ shortSha }}</span>
    <span v-if="expanded" class="time">· {{ timeLabel }}</span>
  </a>
</template>

<style scoped>
.badge {
  position: absolute;
  top: max(10px, env(safe-area-inset-top, 0px));
  left: max(10px, env(safe-area-inset-left, 0px));
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font: 600 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #e6e6ea;
  background: rgba(20, 20, 28, 0.85);
  border: 1px solid rgba(106, 140, 255, 0.4);
  border-radius: 999px;
  text-decoration: none;
  user-select: none;
  cursor: pointer;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  z-index: 10;
}
.badge:hover { background: rgba(34, 34, 46, 0.95); border-color: rgba(106, 140, 255, 0.7); }
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #6a8cff;
  box-shadow: 0 0 8px rgba(106, 140, 255, 0.8);
}
.label {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 10px;
  color: #8a8a99;
}
.sha {
  letter-spacing: 0.04em;
  color: #fff;
}
.time { color: #8a8a99; font-weight: 400; }
</style>
