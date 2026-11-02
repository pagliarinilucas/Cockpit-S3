<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { ref, watch } from 'vue';
import { api } from '../core/api';
import Icon from './Icon.vue';
import Modal from './Modal.vue';
import { t } from '../i18n';

const props = defineProps<{ bucketId: string; bucketName?: string }>();
const emit = defineEmits<{ close: []; pick: [prefix: string] }>();

const path = ref<string[]>([]);          // current navigation path
const folders = ref<string[]>([]);       // folder names at `path`
const loading = ref(false);
const error = ref<string | null>(null);
const manual = ref('');                   // typed prefix override

const prefix = () => (path.value.length ? path.value.join('/') + '/' : '');

async function load() {
  loading.value = true; error.value = null;
  try {
    const res = await api.list(props.bucketId, prefix());
    folders.value = (res.items ?? []).filter((it) => it.kind === 'folder').map((it) => it.name);
  } catch (e) {
    error.value = t('files.picker.listFailed');
    folders.value = [];
  } finally {
    loading.value = false;
  }
}
watch(() => props.bucketId, () => { path.value = []; load(); }, { immediate: true });

function enter(name: string) { path.value = [...path.value, name]; load(); }
function up(i: number) { path.value = path.value.slice(0, i); load(); }
function root() { path.value = []; load(); }

function confirmCurrent() { emit('pick', prefix()); }
function confirmManual() {
  const p = manual.value.trim();
  emit('pick', p ? (p.endsWith('/') ? p : p + '/') : '');
}
</script>

<template>
  <Modal :title="t('files.picker.title')" icon="database" @close="emit('close')">
    <p class="modal-text">Bucket <strong>{{ bucketName ?? bucketId }}</strong></p>

    <div class="fp-crumbs">
      <button class="fp-crumb" @click="root">{{ t('files.picker.root') }}</button>
      <template v-for="(seg, i) in path" :key="i">
        <span class="fp-sep">/</span>
        <button class="fp-crumb" @click="up(i + 1)">{{ seg }}</button>
      </template>
    </div>

    <div v-if="loading" class="loading"><div class="spinner"></div>{{ t('files.picker.loading') }}</div>
    <div v-else-if="error" class="modal-hint" style="color:var(--danger)">{{ error }}</div>
    <div v-else class="fp-list">
      <button v-for="f in folders" :key="f" class="fp-item" @click="enter(f)">
        <Icon name="database" :size="15" /> {{ f }}
      </button>
      <p v-if="!folders.length" class="modal-hint">{{ t('files.picker.noSubfolders') }}</p>
    </div>

    <div class="field" style="margin-top:12px">
      <label class="field-label">{{ t('files.picker.prefixLabel') }}</label>
      <div class="fp-prefix">
        <input class="field-input" v-model="manual" :placeholder="t('files.picker.prefixPlaceholder')" @keydown.enter="confirmManual" />
        <button class="btn" @click="confirmManual" :title="t('files.picker.useTyped')"><Icon name="check" :size="16" />{{ t('files.picker.use') }}</button>
      </div>
    </div>

    <template #foot>
      <button class="btn" @click="emit('close')">{{ t('common.cancel') }}</button>
      <button class="btn btn-primary" @click="confirmCurrent"><Icon name="check" :size="16" />{{ t('files.picker.useThis') }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.fp-crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 10px 0; }
.fp-crumb { background: none; border: none; color: var(--neon); cursor: pointer; padding: 2px 4px; font-size: 13px; font-family: var(--mono); }
.fp-sep { color: var(--text-3); }
.fp-list { max-height: 220px; overflow: auto; display: flex; flex-direction: column; gap: 5px; }
.fp-item { display: flex; align-items: center; gap: 8px; text-align: left; background: var(--bg-2); border: 1px solid var(--line-2); border-radius: 8px; padding: 9px 11px; cursor: pointer; color: var(--text); font-size: 13px; transition: border-color .14s, background .14s; }
.fp-item:hover { border-color: color-mix(in srgb, var(--neon) 45%, transparent); background: var(--bg-3); }
.fp-prefix { display: flex; gap: 8px; }
.fp-prefix .field-input { flex: 1; min-width: 0; }
.fp-prefix .btn { flex: none; height: 46px; }
</style>
