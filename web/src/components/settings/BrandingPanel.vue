<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { BrandingSettings, BrandingInput } from '../../core/models';
import { api, apiErrMsg, ApiError } from '../../core/api';
import { useBranding, DEFAULT_PRODUCT_NAME } from '../../core/branding';
import { useToast } from '../../core/toast';
import Icon from '../Icon.vue';
import Modal from '../Modal.vue';
import ProGate from '../ProGate.vue';
import { t } from '../../i18n';

const MAX_LOGO_BYTES = 256 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const FALLBACK_ACCENT = '#2dd4ff';

const toast = useToast();
const { refresh: refreshBranding } = useBranding();
const settings = ref<BrandingSettings | null>(null);
const editing = ref(false);
const saving = ref(false);
const formError = ref<string | null>(null);

const productName = ref('');
const useAccent = ref(false);
const accentColor = ref(FALLBACK_ACCENT);
const logo = ref<string | null>(null);
const sharePageMessage = ref('');
const hidePoweredBy = ref(false);

async function load() {
  try { settings.value = await api.brandingSettings(); } catch { settings.value = null; }
}
onMounted(load);

function openEdit() {
  const s = settings.value;
  productName.value = s?.productName ?? DEFAULT_PRODUCT_NAME;
  useAccent.value = !!s?.accentColor;
  accentColor.value = s?.accentColor ?? FALLBACK_ACCENT;
  logo.value = s?.logo ?? null;
  sharePageMessage.value = s?.sharePageMessage ?? '';
  hidePoweredBy.value = !!s?.hidePoweredBy;
  formError.value = null;
  editing.value = true;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function onLogoPicked(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  formError.value = null;
  if (!LOGO_TYPES.includes(file.type)) { formError.value = t('settings.branding.logoType'); return; }
  if (file.size > MAX_LOGO_BYTES) { formError.value = t('settings.branding.logoSize'); return; }
  try { logo.value = await readAsDataUrl(file); }
  catch { formError.value = t('settings.branding.readFailed'); }
}

async function save() {
  saving.value = true; formError.value = null;
  const body: BrandingInput = {
    productName: productName.value.trim(),
    accentColor: useAccent.value ? accentColor.value : null,
    logo: logo.value === settings.value?.logo ? undefined : logo.value,
    sharePageMessage: sharePageMessage.value.trim(),
  };
  if (settings.value?.whiteLabel) body.hidePoweredBy = hidePoweredBy.value;
  try {
    settings.value = await api.saveBranding(body);
    await refreshBranding();
    editing.value = false;
    toast.success(t('settings.branding.saved'));
  } catch (e) {
    formError.value = e instanceof ApiError && e.status === 413
      ? t('settings.branding.logoSize')
      : e instanceof ApiError && e.status === 400
        ? t('settings.branding.invalid')
        : apiErrMsg(e, 'save');
  } finally { saving.value = false; }
}
</script>

<template>
  <ProGate feature="branding" :title="t('settings.branding.title')" :pitch="t('settings.branding.pitch')">
    <div class="br-card">
      <div class="br-preview" :style="settings?.accentColor ? { '--neon': settings.accentColor } : undefined">
        <div v-if="settings?.logo" class="br-logo"><img :src="settings.logo" alt="Logo" /></div>
        <div v-else class="br-logo br-logo-default"><Icon name="gauge" :size="20" /></div>
      </div>
      <div class="br-main">
        <div class="br-title">
          {{ t('settings.branding.title') }}
          <span v-if="settings?.accentColor" class="br-swatch" :style="{ background: settings.accentColor }"></span>
        </div>
        <div class="br-desc">{{ settings?.productName ?? DEFAULT_PRODUCT_NAME }}</div>
        <div v-if="settings?.sharePageMessage" class="br-desc br-msg">“{{ settings.sharePageMessage }}”</div>
      </div>
      <div class="br-acts">
        <button class="btn btn-primary" @click="openEdit"><Icon name="palette" :size="15" />{{ t('settings.branding.customize') }}</button>
      </div>
    </div>

    <Modal v-if="editing" :title="t('settings.branding.title')" icon="palette" @close="editing = false">
      <div class="field">
        <label class="field-label" for="br-name">{{ t('settings.branding.productName') }}</label>
        <input id="br-name" v-model="productName" class="field-input" maxlength="60" :placeholder="DEFAULT_PRODUCT_NAME" />
      </div>

      <div class="field">
        <span class="field-label">Logo</span>
        <div class="br-logo-row">
          <div v-if="logo" class="br-logo"><img :src="logo" alt="Logo" /></div>
          <div v-else class="br-logo br-logo-default"><Icon name="gauge" :size="20" /></div>
          <label class="btn">
            <Icon name="upload" :size="15" />{{ t('settings.branding.chooseImage') }}
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden @change="onLogoPicked" />
          </label>
          <button v-if="logo" class="btn" @click="logo = null"><Icon name="trash" :size="15" />{{ t('common.remove') }}</button>
        </div>
        <div class="br-hint">{{ t('settings.branding.logoHint') }}</div>
      </div>

      <div class="field">
        <span class="field-label">{{ t('settings.branding.accent') }}</span>
        <div class="br-color-row">
          <label class="br-check"><input v-model="useAccent" type="checkbox" /> {{ t('settings.branding.useAccent') }}</label>
          <input v-model="accentColor" type="color" class="br-color" :disabled="!useAccent" />
          <code>{{ useAccent ? accentColor : t('settings.branding.themeColor') }}</code>
        </div>
        <div class="br-hint">{{ t('settings.branding.accentHint') }}</div>
      </div>

      <div class="field">
        <label class="field-label" for="br-msg">{{ t('settings.branding.shareMessage') }}</label>
        <textarea id="br-msg" v-model="sharePageMessage" class="field-input" rows="3" maxlength="280"
                  :placeholder="t('settings.branding.shareMessagePlaceholder')"></textarea>
      </div>

      <label class="br-check" :class="{ 'br-disabled': !settings?.whiteLabel }">
        <input v-model="hidePoweredBy" type="checkbox" :disabled="!settings?.whiteLabel" />
        {{ t('settings.branding.hidePoweredBy') }}
        <span v-if="!settings?.whiteLabel" class="br-tag">Enterprise</span>
      </label>

      <div v-if="formError" class="br-error">{{ formError }}</div>
      <template #foot>
        <button class="btn" @click="editing = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="saving" @click="save">{{ saving ? t('settings.saving') : t('common.save') }}</button>
      </template>
    </Modal>
  </ProGate>
</template>

<style scoped>
.br-card {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding: 14px 16px; margin-bottom: 18px;
  border: 1px solid var(--line-2, rgba(255,255,255,.1)); border-radius: 12px;
  background: var(--bg-0, rgba(255,255,255,.02));
}
.br-logo {
  flex: none; width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; overflow: hidden;
  background: var(--bg-2);
}
.br-logo img { width: 100%; height: 100%; object-fit: contain; padding: 3px; }
.br-logo-default { color: var(--neon, #2dd4ff); background: color-mix(in srgb, var(--neon, #2dd4ff) 14%, transparent); }
.br-main { flex: 1; min-width: 220px; }
.br-title { font-weight: 600; margin-bottom: 3px; display: flex; align-items: center; gap: 8px; }
.br-swatch { width: 12px; height: 12px; border-radius: 50%; border: 1px solid var(--line-2); }
.br-desc { font-size: 12.5px; line-height: 1.5; color: var(--text-3, #9aa4b2); }
.br-msg { font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 520px; }
.br-acts { display: flex; gap: 8px; flex-wrap: wrap; flex: none; }
.br-logo-row, .br-color-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.br-logo-row .btn { cursor: pointer; }
.br-color { width: 42px; height: 30px; padding: 0; border: 1px solid var(--line-2); border-radius: 6px; background: none; cursor: pointer; }
.br-color:disabled { opacity: .4; cursor: not-allowed; }
.br-color-row code { font-family: var(--mono); font-size: 12px; color: var(--text-3); }
.br-hint { font-size: 12px; color: var(--text-3); margin-top: 6px; }
.br-check { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-2); }
.br-disabled { opacity: .6; }
.br-tag {
  font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em;
  padding: 2px 7px; border-radius: 999px; border: 1px solid currentColor; color: var(--amber, #ffb02e);
}
.br-error { color: var(--danger); font-size: 13px; margin-top: 10px; }
textarea.field-input { resize: vertical; width: 100%; }
</style>
