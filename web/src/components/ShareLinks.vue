<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { Share } from '../core/models';
import { api, apiErrMsg } from '../core/api';
import { useToast } from '../core/toast';
import { timeAgo } from '../core/util';
import Modal from './Modal.vue';
import Icon from './Icon.vue';

const emit = defineEmits<{ close: [] }>();
const toast = useToast();

const shares = ref<Share[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const revoking = ref<string | null>(null);

const STATUS_LABEL: Record<Share['status'], string> = {
  active: 'ativo', expired: 'expirado', revoked: 'revogado',
};

async function load() {
  loading.value = true; error.value = null;
  try { shares.value = (await api.listShares()) ?? []; }
  catch (e) { error.value = apiErrMsg(e); }
  finally { loading.value = false; }
}
onMounted(load);

const fileName = (s: Share) => s.key.split('/').pop() || s.key;

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR');
}

function ipLabel(s: Share): string {
  if (s.boundIp) return s.boundIp;
  if (s.lockIp) return 'aguardando 1º acesso';
  return '—';
}

async function copy(s: Share) {
  try {
    await navigator.clipboard.writeText(`${window.location.origin}/s/${s.token}`);
    toast.info('Link copiado');
  } catch { toast.error('Falha ao copiar'); }
}

async function revoke(s: Share) {
  if (revoking.value) return;
  revoking.value = s.token;
  try { await api.revokeShare(s.token); toast.success('Link revogado'); await load(); }
  catch (e) { toast.error(apiErrMsg(e, 'revogar')); }
  finally { revoking.value = null; }
}
</script>

<template>
  <Modal title="Links de compartilhamento" icon="link" wide @close="emit('close')">
    <div v-if="loading" class="loading"><div class="spinner"></div>CARREGANDO…</div>
    <div v-else-if="error" class="errbox">
      <Icon name="alert" :size="28" />
      <div class="errbox-title">Não foi possível carregar</div>
      <div class="errbox-sub">{{ error }}</div>
      <button class="btn" @click="load"><Icon name="refresh" :size="15" />Tentar de novo</button>
    </div>
    <p v-else-if="!shares.length" class="modal-hint">Você ainda não criou links de compartilhamento.</p>

    <div v-else class="share-list">
      <div v-for="s in shares" :key="s.token" class="share-row">
        <div class="share-row-main">
          <div class="share-row-name" :title="s.key"><Icon name="file" :size="14" /> {{ fileName(s) }}</div>
          <span class="share-badge" :class="'share-' + s.status">{{ STATUS_LABEL[s.status] }}</span>
        </div>
        <div class="share-row-meta">
          <span title="Bucket"><Icon name="database" :size="12" /> {{ s.bucketId }}</span>
          <span class="dot-sep">·</span>
          <span title="Criado">criado {{ timeAgo(s.createdAt) }}</span>
          <span class="dot-sep">·</span>
          <span title="Expira"><Icon name="clock" :size="12" /> expira {{ fmtDate(s.expiresAt) }}</span>
          <span class="dot-sep">·</span>
          <span title="IP travado"><Icon name="lock" :size="12" /> {{ ipLabel(s) }}</span>
        </div>
        <div class="share-row-acts">
          <button class="iconbtn" title="Copiar link" @click="copy(s)"><Icon name="copy" :size="15" /></button>
          <button v-if="s.status === 'active'" class="iconbtn iconbtn-danger" title="Revogar"
                  :disabled="revoking === s.token" @click="revoke(s)"><Icon name="x" :size="15" /></button>
        </div>
      </div>
    </div>
  </Modal>
</template>
