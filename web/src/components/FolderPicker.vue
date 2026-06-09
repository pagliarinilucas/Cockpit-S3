<script setup lang="ts">
import { ref, watch } from 'vue';
import { api } from '../core/api';
import Icon from './Icon.vue';
import Modal from './Modal.vue';

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
    const res = await api.list(props.bucketId, prefix.value);
    folders.value = (res.items ?? []).filter((it) => it.kind === 'folder').map((it) => it.name);
  } catch (e) {
    error.value = 'Falha ao listar pastas.';
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
  <Modal title="Escolher pasta" icon="database" @close="emit('close')">
    <p class="modal-text">Bucket <strong>{{ bucketName ?? bucketId }}</strong></p>

    <div class="fp-crumbs">
      <button class="fp-crumb" @click="root">raiz</button>
      <template v-for="(seg, i) in path" :key="i">
        <span class="fp-sep">/</span>
        <button class="fp-crumb" @click="up(i + 1)">{{ seg }}</button>
      </template>
    </div>

    <div v-if="loading" class="loading"><div class="spinner"></div>CARREGANDO…</div>
    <div v-else-if="error" class="modal-hint" style="color:var(--danger)">{{ error }}</div>
    <div v-else class="fp-list">
      <button v-for="f in folders" :key="f" class="fp-item" @click="enter(f)">
        <Icon name="database" :size="15" /> {{ f }}
      </button>
      <p v-if="!folders.length" class="modal-hint">Sem subpastas aqui.</p>
    </div>

    <div class="field" style="margin-top:12px">
      <label class="field-label">Ou digite o prefixo (vazio = bucket inteiro)</label>
      <input class="field-input" v-model="manual" placeholder="ex: financeiro/2026/" @keydown.enter="confirmManual" />
    </div>

    <template #foot>
      <button class="btn" @click="emit('close')">Cancelar</button>
      <button class="btn" @click="confirmManual"><Icon name="check" :size="16" />Usar prefixo digitado</button>
      <button class="btn btn-primary" @click="confirmCurrent"><Icon name="check" :size="16" />Usar esta pasta ({{ prefix() || 'raiz' }})</button>
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
</style>
