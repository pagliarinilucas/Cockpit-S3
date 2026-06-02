<script setup lang="ts">
import { computed } from 'vue';
import { ICON_PATHS } from '../core/icons';

const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 18 });

const svg = computed(() => {
  const path = ICON_PATHS[props.name] || ICON_PATHS['file'];
  return `<svg width="${props.size}" height="${props.size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
});
</script>

<template>
  <span class="ic" :style="{ width: size + 'px', height: size + 'px' }" v-html="svg"></span>
</template>
