<script setup lang="ts">
import { computed } from 'vue';
const props = withDefaults(defineProps<{ value: number; color?: string; height?: number }>(),
  { color: 'var(--neon)', height: 6 });
const pct = computed(() => Math.max(0, Math.min(1, props.value)) * 100);
</script>

<template>
  <div class="levelbar" :style="{ height: height + 'px' }">
    <div class="levelbar-fill" :style="{ width: pct + '%', background: color }"></div>
  </div>
</template>
