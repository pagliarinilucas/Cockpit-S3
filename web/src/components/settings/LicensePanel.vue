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
import { t, fmtDate as fmtLocaleDate } from '../../i18n';

const toast = useToast();
const status = ref<LicenseStatus | null>(null);
const editing = ref(false);
const keyInput = ref('');
const saving = ref(false);
const formError = ref<string | null>(null);

const EDITION_LABEL = { community: 'Community', pro: 'Pro', enterprise: 'Enterprise' } as const;
const REASONS = ['malformed', 'bad_signature', 'unsupported'] as const;
type Reason = (typeof REASONS)[number];
const isReason = (value: string): value is Reason => (REASONS as readonly string[]).includes(value);
const reasonLabel = (error: string | null | undefined) => {
  const code = error ?? '';
  return isReason(code) ? t(`settings.license.reason.${code}`) : code;
};

const fmtDate = (iso: string | null) => (iso ? fmtLocaleDate(iso, '—') : '—');

const summary = computed(() => {
  const s = status.value;
  if (!s) return '';
  if (s.state === 'none') return t('settings.license.none');
  if (s.state === 'invalid') return t('settings.license.invalid', { reason: reasonLabel(s.error) });
  const who = s.instance ? t('settings.license.instance', { licensee: s.licensee ?? '', instance: s.instance }) : String(s.licensee ?? '');
  if (s.state === 'expired' && s.edition !== 'community') {
    return t('settings.license.expiredActive', { who, date: fmtDate(s.expiresAt) });
  }
  if (s.state === 'expired') return t('settings.license.expired', { who, date: fmtDate(s.expiresAt), release: s.releaseDate ?? '' });
  return t('settings.license.validUntil', { who, date: fmtDate(s.expiresAt) });
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
    toast.success(t('settings.license.activated', { edition: EDITION_LABEL[status.value.edition] }));
  } catch (e) {
    formError.value = e instanceof ApiError && e.status === 400
      ? t('settings.license.invalidKey')
      : e instanceof ApiError && e.status === 409
        ? t('settings.license.fromEnv')
        : apiErrMsg(e, 'save');
  } finally { saving.value = false; }
}

async function remove() {
  if (!confirm(t('settings.license.removeConfirm'))) return;
  try {
    status.value = await api.removeLicense();
    await Promise.all([refreshEdition(), loadBranding()]);
    toast.info(t('settings.license.removed'));
  } catch (e) { toast.error(apiErrMsg(e, 'remove')); }
}
</script>

<template>
  <div class="lic-card">
    <div class="lic-ic"><Icon name="key" :size="20" /></div>
    <div class="lic-main">
      <div class="lic-title">
        {{ t('settings.license.title') }}
        <span v-if="status" class="lic-tag" :class="'lic-' + status.edition">{{ EDITION_LABEL[status.edition] }}</span>
      </div>
      <div class="lic-desc">{{ summary }}</div>
      <div v-if="status?.source === 'env'" class="lic-desc">{{ t('settings.license.setByEnv') }}</div>
    </div>
    <div class="lic-acts">
      <a v-if="status?.edition === 'community'" class="btn" :href="PRICING_URL" target="_blank" rel="noopener">
        <Icon name="share" :size="15" />{{ t('settings.license.seePlans') }}
      </a>
      <button v-if="status?.source !== 'env'" class="btn btn-primary" @click="openEdit">
        <Icon name="key" :size="15" />{{ status?.state === 'none' ? t('settings.license.activate') : t('settings.license.change') }}
      </button>
      <button v-if="status?.source === 'database'" class="btn btn-danger" @click="remove">
        <Icon name="trash" :size="15" />{{ t('common.remove') }}
      </button>
    </div>
  </div>

  <Modal v-if="editing" :title="t('settings.license.activate')" icon="key" @close="editing = false">
    <p class="lic-desc">{{ t('settings.license.modalIntro') }}</p>
    <div class="field">
      <label class="field-label" for="license-key">{{ t('settings.license.keyLabel') }}</label>
      <textarea id="license-key" v-model="keyInput" class="field-input lic-key" rows="6" placeholder="CS3-…" spellcheck="false"></textarea>
    </div>
    <div v-if="formError" class="lic-error">{{ formError }}</div>
    <template #foot>
      <button class="btn" @click="editing = false">{{ t('common.cancel') }}</button>
      <button class="btn btn-primary" :disabled="saving || keyInput.trim().length < 10" @click="save">
        {{ saving ? t('settings.license.validating') : t('settings.license.activateShort') }}
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
