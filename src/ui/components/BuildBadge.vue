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
  // HH:MM on the build date, in the viewer's local zone.
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
    :title="`Build ${sha}\n${time}\n(click to expand, double-click to open commit)`"
  >
    <span class="dot" />
    <span class="sha">{{ shortSha }}</span>
    <span v-if="expanded" class="time">· {{ timeLabel }}</span>
  </a>
</template>

<style scoped>
.badge {
  position: absolute;
  left: 8px;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #c2c2cc;
  background: rgba(20, 20, 28, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  text-decoration: none;
  user-select: none;
  cursor: pointer;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 10;
}
.badge:hover { background: rgba(30, 30, 40, 0.85); }
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #6a8cff;
  box-shadow: 0 0 6px rgba(106, 140, 255, 0.6);
}
.sha { letter-spacing: 0.04em; }
.time { color: #8a8a99; }
</style>
