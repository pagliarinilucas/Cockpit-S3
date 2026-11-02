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

const DAY_MS = 86_400_000;

const term = computed(() => {
  const s = status.value;
  if (!s?.issuedAt || !s.expiresAt) return null;
  const start = Date.parse(s.issuedAt);
  const end = Date.parse(s.expiresAt);
  const now = Date.now();
  const total = Math.max(end - start, 1);
  const elapsed = Math.min(Math.max(now - start, 0), total);
  return {
    progress: elapsed / total,
    daysLeft: Math.max(0, Math.ceil((end - now) / DAY_MS)),
    ended: now > end,
  };
});

const tone = computed(() => {
  const s = status.value;
  if (!s || s.state === 'none') return 'is-community';
  if (s.state === 'invalid') return 'is-invalid';
  if (s.state === 'expired') return 'is-expired';
  return s.edition === 'enterprise' ? 'is-enterprise' : 'is-pro';
});

type EditionKey = 'community' | 'pro' | 'enterprise';
const EDITIONS: EditionKey[] = ['community', 'pro', 'enterprise'];
const COMPARE_ROWS: { key: 'core' | 'users' | 'commercial' | 'sso' | 'audit' | 'branding' | 'whiteLabel'; from: EditionKey }[] = [
  { key: 'core', from: 'community' },
  { key: 'users', from: 'community' },
  { key: 'commercial', from: 'pro' },
  { key: 'sso', from: 'pro' },
  { key: 'audit', from: 'pro' },
  { key: 'branding', from: 'pro' },
  { key: 'whiteLabel', from: 'enterprise' },
];
const includes = (edition: EditionKey, from: EditionKey) => EDITIONS.indexOf(edition) >= EDITIONS.indexOf(from);
const supportLabel = (edition: EditionKey) =>
  edition === 'community' ? t('settingsLayout.license.supportCommunity')
    : edition === 'pro' ? t('settingsLayout.license.supportPro') : t('settingsLayout.license.supportEnterprise');

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
  <div class="cfg-panel lic-panel" :class="tone">
    <div class="lic-plate">
      <div class="lic-plate-label">{{ t('settingsLayout.license.editionLabel') }}</div>
      <div class="lic-plate-name">{{ status ? EDITION_LABEL[status.edition] : '—' }}</div>
      <div class="lic-plate-sub">{{ status?.edition === 'community' ? 'AGPL-3.0' : t('settings.license.title') }}</div>
      <div class="lic-plate-rivets" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
    </div>
    <div class="lic-body">
      <p class="cfg-panel-desc lic-summary">{{ status?.state === 'none' ? t('settingsLayout.license.communityPitch') : summary }}</p>
      <div v-if="status && status.state !== 'none' && status.state !== 'invalid'" class="cfg-readouts lic-readouts">
        <div class="cfg-readout">
          <div class="cfg-readout-label">{{ t('settingsLayout.license.licensee') }}</div>
          <div class="cfg-readout-value">{{ status.licensee }}</div>
        </div>
        <div class="cfg-readout">
          <div class="cfg-readout-label">{{ t('settingsLayout.license.validUntil') }}</div>
          <div class="cfg-readout-value" :class="{ 'is-warn': term?.ended }">{{ fmtDate(status.expiresAt) }}</div>
        </div>
        <div class="cfg-readout">
          <div class="cfg-readout-label">{{ t('settingsLayout.license.instance') }}</div>
          <div class="cfg-readout-value" :class="{ 'is-off': !status.instance }">{{ status.instance || '—' }}</div>
        </div>
        <div class="cfg-readout">
          <div class="cfg-readout-label">{{ t('settingsLayout.license.source') }}</div>
          <div class="cfg-readout-value">{{ status.source === 'env' ? t('settingsLayout.license.sourceEnv') : t('settingsLayout.license.sourceDb') }}</div>
        </div>
      </div>
      <div v-if="term && status?.state !== 'invalid'" class="lic-term">
        <div class="lic-term-bar"><span :style="{ width: (term.progress * 100).toFixed(1) + '%' }"></span></div>
        <div class="lic-term-text">{{ term.ended ? t('settingsLayout.license.termEnded') : t('settingsLayout.license.daysLeft', { count: term.daysLeft }) }}</div>
      </div>
      <div v-if="status?.source === 'env'" class="cfg-note">{{ t('settings.license.setByEnv') }}</div>
      <div class="cfg-actions lic-actions">
        <button v-if="status?.source !== 'env'" class="btn btn-primary" @click="openEdit">
          <Icon name="key" :size="15" />{{ status?.state === 'none' ? t('settings.license.activate') : t('settings.license.change') }}
        </button>
        <a v-if="status?.edition === 'community'" class="btn" :href="PRICING_URL" target="_blank" rel="noopener">
          <Icon name="share" :size="15" />{{ t('settings.license.seePlans') }}
        </a>
        <button v-if="status?.source === 'database'" class="btn btn-danger" @click="remove">
          <Icon name="trash" :size="15" />{{ t('common.remove') }}
        </button>
      </div>
    </div>
  </div>

  <div class="cfg-panel lic-compare">
    <div class="cfg-panel-title">{{ t('settingsLayout.license.compareTitle') }}</div>
    <div class="lic-table-wrap">
      <table class="lic-table">
        <thead>
          <tr>
            <th></th>
            <th v-for="edition in EDITIONS" :key="edition" :class="{ 'is-current': status?.edition === edition }">
              {{ EDITION_LABEL[edition] }}
              <span v-if="status?.edition === edition" class="lic-current">{{ t('settingsLayout.license.current') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in COMPARE_ROWS" :key="row.key">
            <th scope="row">{{ t(`settingsLayout.license.rows.${row.key}`) }}</th>
            <td v-for="edition in EDITIONS" :key="edition" :class="{ 'is-current': status?.edition === edition }">
              <Icon v-if="includes(edition, row.from)" name="check" :size="15" class="lic-yes" />
              <span v-else class="lic-no">—</span>
            </td>
          </tr>
          <tr>
            <th scope="row">{{ t('settingsLayout.license.rows.support') }}</th>
            <td v-for="edition in EDITIONS" :key="edition" class="lic-support" :class="{ 'is-current': status?.edition === edition }">{{ supportLabel(edition) }}</td>
          </tr>
        </tbody>
      </table>
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
.lic-panel { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 26px; align-items: start; --plate: var(--text-3); }
.lic-panel.is-pro { --plate: var(--neon); }
.lic-panel.is-enterprise { --plate: var(--amber); }
.lic-panel.is-expired, .lic-panel.is-invalid { --plate: var(--danger); }
.lic-plate {
  position: relative; padding: 22px 20px 20px; border-radius: 12px; text-align: center;
  border: 2px solid color-mix(in srgb, var(--plate) 60%, transparent);
  background:
    linear-gradient(160deg, color-mix(in srgb, var(--plate) 16%, var(--bg-2)), var(--bg-0));
  box-shadow: 0 0 40px -18px var(--plate), inset 0 1px 0 color-mix(in srgb, var(--text) 10%, transparent);
}
.lic-plate-label { font-family: var(--mono); font-size: 9.5px; letter-spacing: 2px; text-transform: uppercase; color: var(--text-3); }
.lic-plate-name {
  margin-top: 8px; font-family: var(--display-font); font-weight: 800; font-size: clamp(19px, 2vw, 24px); letter-spacing: 1.2px; text-transform: uppercase; overflow-wrap: anywhere;
  color: var(--plate); text-shadow: 0 0 22px color-mix(in srgb, var(--plate) 45%, transparent);
}
.lic-plate-sub { margin-top: 6px; font-family: var(--mono); font-size: 11px; color: var(--text-2); }
.lic-plate-rivets span {
  position: absolute; width: 6px; height: 6px; border-radius: 50%;
  background: color-mix(in srgb, var(--plate) 50%, var(--bg-3)); box-shadow: inset 0 1px 1px rgba(0,0,0,.6);
}
.lic-plate-rivets span:nth-child(1) { top: 8px; left: 8px; }
.lic-plate-rivets span:nth-child(2) { top: 8px; right: 8px; }
.lic-plate-rivets span:nth-child(3) { bottom: 8px; left: 8px; }
.lic-plate-rivets span:nth-child(4) { bottom: 8px; right: 8px; }
.lic-body { min-width: 0; }
.lic-summary { margin-top: 0; }
.lic-readouts { margin-top: 14px; }
.lic-term { margin-top: 14px; display: flex; align-items: center; gap: 12px; }
.lic-term-bar { flex: 1; height: 6px; border-radius: 999px; background: var(--bg-0); border: 1px solid var(--line); overflow: hidden; }
.lic-term-bar span { display: block; height: 100%; background: linear-gradient(90deg, color-mix(in srgb, var(--plate) 55%, transparent), var(--plate)); }
.lic-term-text { flex: none; font-family: var(--mono); font-size: 11.5px; color: var(--text-2); }
.lic-actions { margin-top: 18px; }
.lic-compare .cfg-panel-title { margin-bottom: 14px; }
.lic-table-wrap { overflow-x: auto; }
.lic-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.lic-table th, .lic-table td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: center; }
.lic-table thead th {
  font-family: var(--display-font); font-weight: 600; letter-spacing: .4px; color: var(--text); white-space: nowrap;
}
.lic-table tbody th { text-align: left; font-weight: 400; color: var(--text-2); }
.lic-table .is-current { background: color-mix(in srgb, var(--neon) 6%, transparent); }
.lic-current {
  display: block; margin-top: 3px; font-family: var(--mono); font-size: 9px; letter-spacing: 1.2px; text-transform: uppercase; color: var(--neon);
}
.lic-yes { color: var(--green); }
.lic-no { color: var(--text-3); }
.lic-support { font-size: 12px; color: var(--text-2); }
.lic-key { font-family: var(--mono); font-size: 12px; word-break: break-all; resize: vertical; width: 100%; }
.lic-desc { font-size: 12.5px; line-height: 1.5; color: var(--text-2); }
.lic-error { color: var(--danger); font-size: 13px; }
@media (max-width: 760px) { .lic-panel { grid-template-columns: 1fr; } }
</style>
