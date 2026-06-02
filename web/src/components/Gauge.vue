<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  value: number; size?: number; stroke?: number; color?: string; label?: string; sub?: string;
}>(), { size: 92, stroke: 8, color: 'var(--neon)', label: '', sub: '' });

const r = computed(() => (props.size - props.stroke) / 2);
const c = computed(() => props.size / 2);
const circ = computed(() => 2 * Math.PI * r.value);
const arcLen = computed(() => (270 / 360) * circ.value);
const filled = computed(() => Math.max(0, Math.min(1, props.value)) * arcLen.value);
</script>

<template>
  <div class="gauge" :style="{ width: size + 'px', height: size + 'px' }">
    <svg :width="size" :height="size" style="transform: rotate(135deg)">
      <circle :cx="c" :cy="c" :r="r" fill="none" stroke="rgba(125,165,220,0.12)"
        :stroke-width="stroke" :stroke-dasharray="arcLen + ' ' + circ" stroke-linecap="round" />
      <circle :cx="c" :cy="c" :r="r" fill="none" :stroke="color"
        :stroke-width="stroke" :stroke-dasharray="filled + ' ' + circ" stroke-linecap="round"
        :style="{ filter: 'drop-shadow(0 0 5px ' + color + ')', transition: 'stroke-dasharray .6s cubic-bezier(.2,.8,.2,1)' }" />
    </svg>
    <div class="gauge-center">
      <div class="gauge-val" :style="{ color }">{{ label }}</div>
      <div v-if="sub" class="gauge-sub">{{ sub }}</div>
    </div>
  </div>
</template>
