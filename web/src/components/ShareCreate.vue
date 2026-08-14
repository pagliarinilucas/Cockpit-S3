<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { ref } from 'vue';
import { api, apiErrMsg } from '../core/api';
import { useToast } from '../core/toast';
import Modal from './Modal.vue';
import Icon from './Icon.vue';

const props = defineProps<{ bucketId: string; objKey: string; filename: string }>();
const emit = defineEmits<{ close: [] }>();
const toast = useToast();

const DURATIONS = [
  { v: 3600, l: '1 hora' },
  { v: 86400, l: '24 horas' },
  { v: 604800, l: '7 dias' },
  { v: 2592000, l: '30 dias' },
];

const ttl = ref(604800);        // padrão 7 dias
const lockIp = ref(false);
const creating = ref(false);
const error = ref<string | null>(null);
const link = ref<string | null>(null);
const expiresAt = ref<string | null>(null);

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR');
}

async function create() {
  if (creating.value) return;
  creating.value = true; error.value = null;
  try {
    const r = await api.createShare(props.bucketId, props.objKey, ttl.value, lockIp.value);
    link.value = `${window.location.origin}/s/${r.token}`;
    expiresAt.value = r.expiresAt;
    toast.success('Link de compartilhamento criado');
  } catch (e) {
    error.value = apiErrMsg(e, 'criar link');
  } finally {
    creating.value = false;
  }
}

async function copy() {
  if (!link.value) return;
  try { await navigator.clipboard.writeText(link.value); toast.info('Link copiado'); }
  catch { toast.error('Falha ao copiar'); }
}
</script>

<template>
  <Modal title="Compartilhar arquivo" icon="share" @close="emit('close')">
    <p class="modal-text">Gerar um link público para <strong>{{ filename }}</strong>.</p>

    <template v-if="!link">
      <div class="field" style="margin-top:12px">
        <label class="field-label"><Icon name="clock" :size="14" /> Expira em</label>
        <select class="modal-input" v-model.number="ttl">
          <option v-for="d in DURATIONS" :key="d.v" :value="d.v">{{ d.l }}</option>
        </select>
      </div>

      <label class="share-check">
        <input type="checkbox" v-model="lockIp" />
        <span class="cbox"><Icon name="check" :size="12" /></span>
        <span><Icon name="lock" :size="13" /> Travar ao primeiro IP que abrir</span>
      </label>
      <p class="modal-hint">Quando ligado, só o primeiro dispositivo/IP que abrir o link poderá usá-lo.</p>

      <p v-if="error" class="modal-hint" style="color:var(--danger)">{{ error }}</p>
    </template>

    <template v-else>
      <div class="share-result">
        <label class="field-label"><Icon name="link" :size="14" /> Link público</label>
        <div class="share-linkbox">
          <input class="modal-input" :value="link" readonly @focus="($event.target as HTMLInputElement).select()" />
          <button class="btn btn-primary" @click="copy"><Icon name="copy" :size="16" />Copiar</button>
        </div>
        <p class="modal-hint" v-if="expiresAt"><Icon name="clock" :size="13" /> Expira em {{ fmtDate(expiresAt) }}</p>
      </div>
    </template>

    <template #foot>
      <button class="btn" @click="emit('close')">{{ link ? 'Fechar' : 'Cancelar' }}</button>
      <button v-if="!link" class="btn btn-primary" :disabled="creating" @click="create">
        <Icon name="share" :size="16" />{{ creating ? 'Criando…' : 'Criar link' }}
      </button>
    </template>
  </Modal>
</template>
