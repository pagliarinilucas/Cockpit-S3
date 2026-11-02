<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
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
const logoInput = ref<HTMLInputElement | null>(null);
const dragging = ref(false);

const ACCENT_PRESETS = ['#2dd4ff', '#4f8cff', '#2fe39a', '#ffb330', '#ff5d72', '#f472b6', '#e5e7eb'];
const previewAccent = computed(() => (useAccent.value ? accentColor.value : null));
const previewName = computed(() => productName.value.trim() || DEFAULT_PRODUCT_NAME);

function pickPreset(color: string) {
  useAccent.value = true;
  accentColor.value = color;
}

function openLogoPicker() {
  logoInput.value?.click();
}

function onLogoDrop(event: DragEvent) {
  dragging.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file) void acceptLogoFile(file);
}

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
  if (file) await acceptLogoFile(file);
}

async function acceptLogoFile(file: File) {
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
    <div class="cfg-panel br-layout">
      <div class="br-info">
        <div class="cfg-panel-head">
          <div class="cfg-panel-title"><Icon name="palette" :size="17" />{{ t('settings.branding.title') }}</div>
          <div class="cfg-actions">
            <button class="btn btn-primary" @click="openEdit"><Icon name="palette" :size="15" />{{ t('settings.branding.customize') }}</button>
          </div>
        </div>
        <div class="cfg-readouts br-readouts">
          <div class="cfg-readout">
            <div class="cfg-readout-label">{{ t('settingsLayout.branding.name') }}</div>
            <div class="cfg-readout-value">{{ settings?.productName || DEFAULT_PRODUCT_NAME }}</div>
          </div>
          <div class="cfg-readout">
            <div class="cfg-readout-label">{{ t('settingsLayout.branding.logo') }}</div>
            <div class="cfg-readout-value" :class="{ 'is-off': !settings?.logo }">{{ settings?.logo ? t('settingsLayout.branding.logoCustom') : t('settingsLayout.branding.logoDefault') }}</div>
          </div>
          <div class="cfg-readout">
            <div class="cfg-readout-label">{{ t('settingsLayout.branding.accent') }}</div>
            <div class="cfg-readout-value br-accent">
              <span v-if="settings?.accentColor" class="br-swatch" :style="{ background: settings.accentColor }"></span>
              {{ settings?.accentColor || t('settingsLayout.branding.accentTheme') }}
            </div>
          </div>
          <div class="cfg-readout">
            <div class="cfg-readout-label">{{ t('settingsLayout.branding.poweredBy') }}</div>
            <div class="cfg-readout-value">{{ settings?.hidePoweredBy ? t('settingsLayout.branding.poweredHidden') : t('settingsLayout.branding.poweredShown') }}</div>
          </div>
        </div>
        <p v-if="settings?.sharePageMessage" class="cfg-note br-msg">“{{ settings.sharePageMessage }}”</p>
      </div>
      <figure class="br-preview" :style="settings?.accentColor ? { '--neon': settings.accentColor } : undefined">
        <figcaption>{{ t('settingsLayout.branding.preview') }}</figcaption>
        <div class="br-mock">
          <div class="br-mock-brand">
            <div v-if="settings?.logo" class="br-logo"><img :src="settings.logo" alt="Logo" /></div>
            <div v-else class="br-logo br-logo-default"><Icon name="database" :size="18" /></div>
            <span>{{ settings?.productName || DEFAULT_PRODUCT_NAME }}</span>
          </div>
          <div class="br-mock-field">{{ t('settingsLayout.branding.previewUser') }}</div>
          <div class="br-mock-field"></div>
          <div class="br-mock-btn">{{ t('settingsLayout.branding.previewButton') }}</div>
        </div>
      </figure>
    </div>

    <Modal v-if="editing" :title="t('settings.branding.title')" icon="palette" xl @close="editing = false">
      <div class="bre">
        <div class="bre-form">
          <section class="bre-group">
            <h4 class="bre-group-title">{{ t('settingsLayout.branding.identity') }}</h4>
            <div class="field">
              <label class="field-label" for="br-name">{{ t('settings.branding.productName') }}</label>
              <input id="br-name" v-model="productName" class="field-input" maxlength="60" :placeholder="DEFAULT_PRODUCT_NAME" />
            </div>
            <div class="field">
              <span class="field-label">Logo</span>
              <div
                class="bre-drop" :class="{ 'is-dragging': dragging, 'has-logo': !!logo }"
                role="button" tabindex="0"
                @click="openLogoPicker" @keydown.enter.prevent="openLogoPicker" @keydown.space.prevent="openLogoPicker"
                @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onLogoDrop"
              >
                <div class="bre-drop-thumb">
                  <img v-if="logo" :src="logo" alt="Logo" />
                  <Icon v-else name="upload" :size="20" />
                </div>
                <div class="bre-drop-text">
                  <div class="bre-drop-title">{{ logo ? t('settingsLayout.branding.replace') : t('settingsLayout.branding.dropTitle') }}</div>
                  <div class="bre-drop-hint">{{ t('settingsLayout.branding.dropHint') }}</div>
                </div>
                <button v-if="logo" class="iconbtn iconbtn-danger" :title="t('common.remove')" @click.stop="logo = null"><Icon name="trash" :size="15" /></button>
              </div>
              <input ref="logoInput" class="bre-file" type="file" accept="image/png,image/jpeg,image/webp" @change="onLogoPicked" />
            </div>
          </section>

          <section class="bre-group">
            <h4 class="bre-group-title">{{ t('settingsLayout.branding.color') }}</h4>
            <div class="bre-swatches">
              <button class="bre-swatch bre-swatch-theme" :class="{ 'is-on': !useAccent }" :title="t('settingsLayout.branding.followTheme')" @click="useAccent = false">
                <Icon name="refresh" :size="14" />
              </button>
              <button
                v-for="color in ACCENT_PRESETS" :key="color"
                class="bre-swatch" :class="{ 'is-on': useAccent && accentColor.toLowerCase() === color }"
                :style="{ '--swatch': color }" :title="color" @click="pickPreset(color)"
              ></button>
              <label class="bre-swatch bre-swatch-custom" :class="{ 'is-on': useAccent && !ACCENT_PRESETS.includes(accentColor.toLowerCase()) }" :title="t('settingsLayout.branding.custom')">
                <input v-model="accentColor" type="color" @input="useAccent = true" />
              </label>
            </div>
            <div class="bre-color-value"><code>{{ useAccent ? accentColor : t('settingsLayout.branding.followTheme') }}</code></div>
            <div class="br-hint">{{ t('settings.branding.accentHint') }}</div>
          </section>

          <section class="bre-group">
            <h4 class="bre-group-title">{{ t('settingsLayout.branding.publicPages') }}</h4>
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
          </section>

          <div v-if="formError" class="br-error">{{ formError }}</div>
        </div>

        <aside class="bre-preview" :style="previewAccent ? { '--neon': previewAccent } : undefined">
          <div class="bre-preview-label">{{ t('settingsLayout.branding.previewLogin') }}</div>
          <div class="br-mock">
            <div class="br-mock-brand">
              <div v-if="logo" class="br-logo"><img :src="logo" alt="Logo" /></div>
              <div v-else class="br-logo br-logo-default"><Icon name="database" :size="18" /></div>
              <span>{{ previewName }}</span>
            </div>
            <div class="br-mock-field">{{ t('settingsLayout.branding.previewUser') }}</div>
            <div class="br-mock-field"></div>
            <div class="br-mock-btn">{{ t('settingsLayout.branding.previewButton') }}</div>
          </div>

          <div class="bre-preview-label">{{ t('settingsLayout.branding.previewShare') }}</div>
          <div class="bre-share">
            <div class="bre-share-brand">
              <div v-if="logo" class="br-logo"><img :src="logo" alt="Logo" /></div>
              <div v-else class="br-logo br-logo-default"><Icon name="database" :size="15" /></div>
              <span>{{ previewName }}</span>
            </div>
            <p v-if="sharePageMessage.trim()" class="bre-share-msg">{{ sharePageMessage }}</p>
            <div class="bre-share-file"><Icon name="file" :size="15" />{{ t('settingsLayout.branding.previewShareFile') }}</div>
            <div class="br-mock-btn">{{ t('settingsLayout.branding.previewDownload') }}</div>
            <div v-if="!hidePoweredBy" class="bre-share-powered">{{ t('settingsLayout.branding.poweredByText') }}</div>
          </div>
        </aside>
      </div>
      <template #foot>
        <button class="btn" @click="editing = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="saving" @click="save">{{ saving ? t('settings.saving') : t('common.save') }}</button>
      </template>
    </Modal>
  </ProGate>
</template>

<style scoped>
.br-logo {
  flex: none; width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; overflow: hidden;
  background: var(--bg-2);
}
.br-logo img { width: 100%; height: 100%; object-fit: contain; padding: 3px; }
.br-logo-default { color: var(--neon, #2dd4ff); background: color-mix(in srgb, var(--neon, #2dd4ff) 14%, transparent); }
.br-swatch { width: 12px; height: 12px; border-radius: 50%; border: 1px solid var(--line-2); }
.br-msg { font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.br-layout { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 22px; align-items: stretch; }
.br-info { min-width: 0; }
.br-readouts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.br-accent { display: flex; align-items: center; gap: 8px; }
.br-preview {
  margin: 0; display: flex; flex-direction: column; gap: 8px;
}
.br-preview figcaption {
  font-family: var(--mono); font-size: 9.5px; letter-spacing: 1.4px; text-transform: uppercase; color: var(--text-3);
}
.br-mock {
  flex: 1; display: flex; flex-direction: column; gap: 9px; padding: 18px 16px;
  border-radius: 12px; border: 1px solid var(--line-2);
  background:
    radial-gradient(200px 120px at 50% 0%, color-mix(in srgb, var(--neon) 14%, transparent), transparent 70%),
    var(--bg-0);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--neon) 30%, transparent);
}
.br-mock-brand {
  display: flex; align-items: center; gap: 10px; margin-bottom: 6px;
  font-family: var(--display-font); font-weight: 700; letter-spacing: 1px; text-transform: uppercase; font-size: 13px; color: var(--text);
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.br-mock-brand .br-logo { width: 32px; height: 32px; border-radius: 8px; }
.br-mock-field {
  height: 26px; padding: 0 10px; display: flex; align-items: center; border-radius: 7px;
  border: 1px solid var(--line-2); background: var(--bg-1);
  font-family: var(--mono); font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: var(--text-3);
}
.br-mock-btn {
  margin-top: 4px; height: 28px; display: grid; place-items: center; border-radius: 7px;
  font-family: var(--display-font); font-weight: 600; font-size: 12px; color: var(--text);
  border: 1px solid color-mix(in srgb, var(--neon) 45%, transparent);
  background: color-mix(in srgb, var(--neon) 16%, var(--bg-2));
}
.bre { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 26px; align-items: start; }
.bre-form { min-width: 0; display: flex; flex-direction: column; gap: 22px; }
.bre-group-title {
  margin: 0 0 12px; padding-bottom: 8px; border-bottom: 1px solid var(--line);
  font-family: var(--mono); font-size: 10px; font-weight: 500; letter-spacing: 1.6px; text-transform: uppercase; color: var(--neon);
}
.bre-group .field:last-child { margin-bottom: 0; }
.bre-drop {
  display: flex; align-items: center; gap: 14px; padding: 14px; cursor: pointer;
  border: 1.5px dashed var(--line-2); border-radius: 12px; background: var(--bg-0);
  transition: border-color .15s, background .15s;
}
.bre-drop:hover, .bre-drop:focus-visible, .bre-drop.is-dragging {
  outline: none; border-color: color-mix(in srgb, var(--neon) 60%, transparent);
  background: color-mix(in srgb, var(--neon) 6%, var(--bg-0));
}
.bre-drop-thumb {
  flex: none; width: 56px; height: 56px; border-radius: 12px; display: grid; place-items: center; overflow: hidden;
  color: var(--neon); background: color-mix(in srgb, var(--neon) 12%, var(--bg-2));
}
.bre-drop-thumb img { width: 100%; height: 100%; object-fit: contain; padding: 4px; }
.bre-drop-text { flex: 1; min-width: 0; }
.bre-drop-title { font-size: 13.5px; font-weight: 600; color: var(--text); }
.bre-drop-hint { margin-top: 3px; font-size: 12px; color: var(--text-3); }
.bre-file { display: none; }
.bre-swatches { display: flex; flex-wrap: wrap; gap: 8px; }
.bre-swatch {
  position: relative; width: 32px; height: 32px; padding: 0; border-radius: 9px; cursor: pointer;
  border: 1px solid var(--line-2); background: var(--swatch, var(--bg-2));
  display: grid; place-items: center; color: var(--text-2);
  transition: transform .12s;
}
.bre-swatch:hover { transform: translateY(-1px); }
.bre-swatch.is-on { box-shadow: 0 0 0 2px var(--bg-1), 0 0 0 4px var(--swatch, var(--text-2)); }
.bre-swatch-custom { background: conic-gradient(#ff5d72, #ffb330, #2fe39a, #2dd4ff, #4f8cff, #f472b6, #ff5d72); overflow: hidden; }
.bre-swatch-custom input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; border: 0; padding: 0; }
.bre-swatch-custom.is-on { box-shadow: 0 0 0 2px var(--bg-1), 0 0 0 4px var(--text); }
.bre-color-value { margin-top: 10px; }
.bre-color-value code { font-family: var(--mono); font-size: 12px; color: var(--text-2); }
.bre-preview {
  position: sticky; top: 0; display: flex; flex-direction: column; gap: 8px;
  padding: 16px; border-radius: 14px; border: 1px solid var(--line); background: var(--bg-0);
}
.bre-preview-label {
  font-family: var(--mono); font-size: 9.5px; letter-spacing: 1.4px; text-transform: uppercase; color: var(--text-3);
}
.bre-preview .br-mock + .bre-preview-label { margin-top: 10px; }
.bre-share {
  display: flex; flex-direction: column; gap: 9px; padding: 16px; border-radius: 12px;
  border: 1px solid var(--line-2); background: var(--bg-1);
}
.bre-share-brand { display: flex; align-items: center; gap: 8px; font-family: var(--display-font); font-weight: 700; font-size: 12px; letter-spacing: .8px; text-transform: uppercase; }
.bre-share-brand .br-logo { width: 26px; height: 26px; border-radius: 7px; }
.bre-share-msg { margin: 0; font-size: 12px; line-height: 1.45; color: var(--text-2); overflow-wrap: anywhere; }
.bre-share-file {
  display: flex; align-items: center; gap: 8px; padding: 9px 10px; border-radius: 8px;
  border: 1px solid var(--line); background: var(--bg-0); font-family: var(--mono); font-size: 11px; color: var(--text);
}
.bre-share-file .ic { color: var(--neon); }
.bre-share-powered { text-align: center; font-family: var(--mono); font-size: 9.5px; color: var(--text-3); }
@media (max-width: 860px) {
  .bre { grid-template-columns: 1fr; }
  .bre-preview { position: static; }
  .br-layout { grid-template-columns: 1fr; }
  .br-readouts { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
}
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
