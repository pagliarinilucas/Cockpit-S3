<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { useBranding } from '../core/branding';
import Icon from './Icon.vue';

defineProps<{ size: number }>();
const { logo, productName } = useBranding();
</script>

<template>
  <div v-if="logo" class="brand-mark brand-mark-logo"><img :src="logo" :alt="productName" /></div>
  <div v-else class="brand-mark"><Icon name="gauge" :size="size" /></div>
</template>

<style scoped>
.brand-mark-logo { overflow: hidden; background: var(--bg-2); box-shadow: none; }
.brand-mark-logo img { width: 100%; height: 100%; object-fit: contain; padding: 4px; }
</style>
