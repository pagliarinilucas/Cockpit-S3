<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { ref, computed } from 'vue';
import { useTheme } from '../core/theme';
import Icon from './Icon.vue';
import { t } from '../i18n';

const { themes, current, scanlines, setTheme, toggleScanlines } = useTheme();
const open = ref(false);
const currentLabel = computed(() => themes.find((t) => t.id === current.value)?.label ?? '');
</script>

<template>
  <div v-if="open" class="tp-panel">
    <div class="tp-title"><Icon name="palette" :size="16" /> {{ t('ui.theme.title') }}</div>
    <div class="tp-grid">
      <button v-for="t in themes" :key="t.id" class="tp-sw" :style="{ background: t.base }"
              :data-on="current === t.id ? 1 : 0" :title="t.label" @click="setTheme(t.id)">
        <i :style="{ background: t.accent }"></i>
      </button>
    </div>
    <div class="tp-names"><span class="tp-name">{{ currentLabel }}</span></div>
    <div class="tp-row">
      <span class="tp-row-label">{{ t('ui.theme.scanlines') }}</span>
      <button class="tp-toggle" :data-on="scanlines ? 1 : 0" @click="toggleScanlines()"><i></i></button>
    </div>
  </div>
  <button class="tp-fab" :title="t('ui.theme.title')" :aria-label="t('ui.theme.title')" @click="open = !open">
    <Icon :name="open ? 'x' : 'palette'" :size="20" />
  </button>
</template>
