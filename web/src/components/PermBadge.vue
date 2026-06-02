<script setup lang="ts">
import { computed } from 'vue';
import type { Perm } from '../core/models';
import { PERM_META } from '../core/perm';
import Icon from './Icon.vue';

const props = withDefaults(defineProps<{ perm: Perm | null; small?: boolean }>(), { small: false });
const meta = computed(() => (props.perm ? PERM_META[props.perm] : null));
</script>

<template>
  <span v-if="meta" class="perm" :class="[meta.cls, { 'perm-sm': small }]">
    <Icon :name="meta.icon" :size="small ? 11 : 13" />{{ meta.label }}
  </span>
</template>
