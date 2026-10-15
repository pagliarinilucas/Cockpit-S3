<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { LicenseStatus } from '../../core/models';
import { api, apiErrMsg, ApiError } from '../../core/api';
import { refreshEdition, PRICING_URL } from '../../core/edition';
import { loadBranding } from '../../core/branding';
import { useToast } from '../../core/toast';
import Icon from '../Icon.vue';
import Modal from '../Modal.vue';

const toast = useToast();
const status = ref<LicenseStatus | null>(null);
const editing = ref(false);
const keyInput = ref('');
const saving = ref(false);
const formError = ref<string | null>(null);

const EDITION_LABEL = { community: 'Community', pro: 'Pro', enterprise: 'Enterprise' } as const;
const REASON_LABEL: Record<string, string> = {
  malformed: 'formato inválido',
  bad_signature: 'assinatura não confere',
  unsupported: 'versão de chave não suportada',
};

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');

const summary = computed(() => {
  const s = status.value;
  if (!s) return '';
  if (s.state === 'none') return 'Sem licença: rodando a edição Community (AGPL), com usuários ilimitados e todo o núcleo.';
  if (s.state === 'invalid') return `Licença inválida (${REASON_LABEL[s.error ?? ''] ?? s.error}). Rodando como Community.`;
  const who = `${s.licensee}${s.instance ? ` · instância ${s.instance}` : ''}`;
  if (s.state === 'expired' && s.edition !== 'community') {
    return `${who} · vigência encerrada em ${fmtDate(s.expiresAt)}. Os recursos seguem ativos nesta versão; renove para receber atualizações.`;
  }
  if (s.state === 'expired') return `${who} · licença expirada em ${fmtDate(s.expiresAt)} e não cobre esta versão (${s.releaseDate}).`;
  return `${who} · válida até ${fmtDate(s.expiresAt)}`;
});

async function load() {
  try { status.value = await api.license(); } catch { status.value = null; }
}
onMounted(load);
defineExpose({ reload: load });

function openEdit() { keyInput.value = ''; formError.value = null; editing.value = true; }

async function save() {
  saving.value = true; formError.value = null;
  try {
    status.value = await api.installLicense(keyInput.value.trim());
    await Promise.all([refreshEdition(), loadBranding()]);
    editing.value = false;
    toast.success(`Licença ${EDITION_LABEL[status.value.edition]} ativada.`);
  } catch (e) {
    formError.value = e instanceof ApiError && e.status === 400
      ? 'Chave inválida. Confira se colou a chave inteira, começando por CS3-.'
      : e instanceof ApiError && e.status === 409
        ? 'A licença está definida por variável de ambiente (COCKPIT_LICENSE_KEY/FILE).'
        : apiErrMsg(e, 'salvar');
  } finally { saving.value = false; }
}

async function remove() {
  if (!confirm('Remover a licença? A instância volta para a edição Community.')) return;
  try {
    status.value = await api.removeLicense();
    await Promise.all([refreshEdition(), loadBranding()]);
    toast.info('Licença removida.');
  } catch (e) { toast.error(apiErrMsg(e, 'remover')); }
}
</script>

<template>
  <div class="lic-card">
    <div class="lic-ic"><Icon name="key" :size="20" /></div>
    <div class="lic-main">
      <div class="lic-title">
        Licença
        <span v-if="status" class="lic-tag" :class="'lic-' + status.edition">{{ EDITION_LABEL[status.edition] }}</span>
      </div>
      <div class="lic-desc">{{ summary }}</div>
      <div v-if="status?.source === 'env'" class="lic-desc">Definida por variável de ambiente.</div>
    </div>
    <div class="lic-acts">
      <a v-if="status?.edition === 'community'" class="btn" :href="PRICING_URL" target="_blank" rel="noopener">
        <Icon name="share" :size="15" />Ver planos
      </a>
      <button v-if="status?.source !== 'env'" class="btn btn-primary" @click="openEdit">
        <Icon name="key" :size="15" />{{ status?.state === 'none' ? 'Ativar licença' : 'Trocar licença' }}
      </button>
      <button v-if="status?.source === 'database'" class="btn btn-danger" @click="remove">
        <Icon name="trash" :size="15" />Remover
      </button>
    </div>
  </div>

  <Modal v-if="editing" title="Ativar licença" icon="key" @close="editing = false">
    <p class="lic-desc">
      Cole a chave recebida após a compra. A verificação é feita offline, sem contato com
      servidores externos.
    </p>
    <div class="field">
      <label class="field-label" for="license-key">Chave de licença</label>
      <textarea id="license-key" v-model="keyInput" class="field-input lic-key" rows="6" placeholder="CS3-…" spellcheck="false"></textarea>
    </div>
    <div v-if="formError" class="lic-error">{{ formError }}</div>
    <template #foot>
      <button class="btn" @click="editing = false">Cancelar</button>
      <button class="btn btn-primary" :disabled="saving || keyInput.trim().length < 10" @click="save">
        {{ saving ? 'Validando…' : 'Ativar' }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.lic-card {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding: 14px 16px; margin-bottom: 18px;
  border: 1px solid var(--line-2, rgba(255,255,255,.1)); border-radius: 12px;
  background: var(--bg-0, rgba(255,255,255,.02));
}
.lic-ic {
  flex: none; width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center;
  color: var(--neon, #2dd4ff); background: color-mix(in srgb, var(--neon, #2dd4ff) 14%, transparent);
}
.lic-main { flex: 1; min-width: 220px; }
.lic-title { font-weight: 600; margin-bottom: 3px; display: flex; align-items: center; gap: 8px; }
.lic-tag {
  font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em;
  padding: 2px 7px; border-radius: 999px; border: 1px solid currentColor; line-height: 1.4;
}
.lic-community { color: var(--text-3, #9aa4b2); }
.lic-pro { color: var(--neon, #2dd4ff); }
.lic-enterprise { color: var(--amber, #ffb02e); }
.lic-desc { font-size: 12.5px; line-height: 1.5; color: var(--text-3, #9aa4b2); }
.lic-acts { display: flex; gap: 8px; flex-wrap: wrap; flex: none; }
.lic-acts .btn { text-decoration: none; }
.lic-key { font-family: ui-monospace, monospace; font-size: 12px; word-break: break-all; resize: vertical; width: 100%; }
.lic-error { color: var(--danger); font-size: 13px; }
</style>
