<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue';
import Icon from './Icon.vue';
import { t } from '../i18n';

defineProps<{ title: string; icon?: string; wide?: boolean; xl?: boolean }>();
const emit = defineEmits<{ close: [] }>();

const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') emit('close'); };
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <div class="modal-back" @click="emit('close')">
      <div class="modal" :class="{ 'modal-wide': wide, 'modal-xl': xl }" @click.stop>
        <div class="modal-head">
          <span class="modal-title"><Icon v-if="icon" :name="icon" :size="17" />{{ title }}</span>
          <button class="iconbtn" :aria-label="t('common.close')" :title="t('common.close')" @click="emit('close')"><Icon name="x" :size="16" /></button>
        </div>
        <div class="modal-body"><slot></slot></div>
        <div class="modal-foot"><slot name="foot"></slot></div>
      </div>
    </div>
  </Teleport>
</template>
