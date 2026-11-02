<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import Modal from './Modal.vue';
import Icon from './Icon.vue';
import { t } from '../i18n';

const props = withDefaults(defineProps<{
  title: string; icon?: string; placeholder?: string; hint?: string; confirmLabel?: string; initial?: string;
}>(), { placeholder: '', hint: '', confirmLabel: undefined, initial: '' });

const emit = defineEmits<{ confirm: [value: string]; close: [] }>();
const value = ref(props.initial);
const box = ref<HTMLInputElement | null>(null);
onMounted(() => { box.value?.focus(); box.value?.select(); });
</script>

<template>
  <Modal :title="title" :icon="icon" @close="emit('close')">
    <input ref="box" class="modal-input" v-model="value" :placeholder="placeholder"
           @keydown.enter="emit('confirm', value)" />
    <p v-if="hint" class="modal-hint">{{ hint }}</p>
    <template #foot>
      <button class="btn" @click="emit('close')">{{ t('common.cancel') }}</button>
      <button class="btn btn-primary" @click="emit('confirm', value)"><Icon name="check" :size="16" />{{ confirmLabel ?? t('common.confirm') }}</button>
    </template>
  </Modal>
</template>
