<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api, apiErrMsg, ApiError, type OidcSettings, type OidcTestResult } from '../../core/api';
import { useToast } from '../../core/toast';
import ProGate from '../ProGate.vue';
import Icon from '../Icon.vue';
import Modal from '../Modal.vue';
import { t } from '../../i18n';

const toast = useToast();
const settings = ref<OidcSettings | null>(null);
const editing = ref(false);
const saving = ref(false);
const testing = ref(false);
const formError = ref<string | null>(null);
const testResult = ref<OidcTestResult | null>(null);

const emptyForm = () => ({
  enabled: false,
  issuer: '',
  clientId: '',
  clientSecret: '',
  scopes: 'openid email profile',
  buttonLabel: t('settings.sso.defaultButtonLabel'),
  usernameClaim: 'preferred_username',
  autoProvision: false,
  allowedDomains: '',
  adminGroup: '',
  disablePasswordLogin: false,
});
const form = ref(emptyForm());

const summary = computed(() => {
  const s = settings.value;
  if (!s) return t('settings.sso.summaryEmpty');
  if (!s.enabled) return t('settings.sso.summaryDisabled');
  if (!s.active) return t('settings.sso.summaryInactive');
  const host = (() => { try { return new URL(s.issuer).host; } catch { return s.issuer; } })();
  const extras = [
    s.autoProvision ? t('settings.sso.autoProvision') : t('settings.sso.existingOnly'),
    s.disablePasswordLogin ? t('settings.sso.passwordAdminsOnly') : null,
  ].filter(Boolean).join(' · ');
  return t('settings.sso.summaryActive', { host, extras });
});

async function load() {
  try { settings.value = await api.oidcSettings(); } catch { settings.value = null; }
}
onMounted(load);

function openEdit() {
  const s = settings.value;
  form.value = s
    ? {
      enabled: s.enabled, issuer: s.issuer, clientId: s.clientId, clientSecret: '', scopes: s.scopes,
      buttonLabel: s.buttonLabel, usernameClaim: s.usernameClaim, autoProvision: s.autoProvision,
      allowedDomains: s.allowedDomains.join(', '), adminGroup: s.adminGroup, disablePasswordLogin: s.disablePasswordLogin,
    }
    : emptyForm();
  formError.value = null;
  testResult.value = null;
  editing.value = true;
}

async function copyRedirect() {
  if (!settings.value) return;
  try {
    await navigator.clipboard.writeText(settings.value.redirectUri);
    toast.success(t('settings.sso.redirectCopied'));
  } catch { toast.error(t('settings.sso.copyFailed')); }
}

async function testDiscovery() {
  testing.value = true; testResult.value = null;
  try { testResult.value = await api.testOidc(form.value.issuer.trim() || undefined); }
  catch (e) { testResult.value = { ok: false, error: apiErrMsg(e, 'test') }; }
  finally { testing.value = false; }
}

async function save() {
  saving.value = true; formError.value = null;
  const f = form.value;
  try {
    settings.value = await api.saveOidcSettings({
      enabled: f.enabled,
      issuer: f.issuer.trim(),
      clientId: f.clientId.trim(),
      ...(f.clientSecret ? { clientSecret: f.clientSecret } : {}),
      scopes: f.scopes,
      buttonLabel: f.buttonLabel,
      usernameClaim: f.usernameClaim,
      autoProvision: f.autoProvision,
      allowedDomains: f.allowedDomains.split(/[\s,;]+/).filter(Boolean),
      adminGroup: f.adminGroup,
      disablePasswordLogin: f.disablePasswordLogin,
    });
    editing.value = false;
    toast.success(t('settings.sso.saved'));
  } catch (e) {
    formError.value = e instanceof ApiError && e.status === 400
      ? t('settings.sso.invalid')
      : apiErrMsg(e, 'save');
  } finally { saving.value = false; }
}
</script>

<template>
  <ProGate
    feature="sso"
    :title="t('settings.sso.title')"
    :pitch="t('settings.sso.pitch')"
  >
    <div class="sso-card">
      <div class="sso-ic"><Icon name="shield" :size="20" /></div>
      <div class="sso-main">
        <div class="sso-title">
          {{ t('settings.sso.title') }}
          <span class="sso-tag" :class="settings?.active ? 'sso-on' : 'sso-off'">{{ settings?.active ? t('settings.sso.active') : t('settings.sso.inactive') }}</span>
        </div>
        <div class="sso-desc">{{ summary }}</div>
        <div v-if="settings" class="sso-redirect">
          <span class="sso-desc">Redirect URI:</span>
          <code>{{ settings.redirectUri }}</code>
          <button class="iconbtn" :title="t('settings.sso.copy')" @click="copyRedirect"><Icon name="copy" :size="14" /></button>
        </div>
      </div>
      <div class="sso-acts">
        <button class="btn btn-primary" @click="openEdit"><Icon name="edit" :size="15" />{{ t('settings.configure') }}</button>
      </div>
    </div>
  </ProGate>

  <Modal v-if="editing" :title="t('settings.sso.title')" icon="shield" wide @close="editing = false">
    <div class="field">
      <label class="field-label"><input type="checkbox" v-model="form.enabled" /> {{ t('settings.sso.enable') }}</label>
    </div>
    <div class="field">
      <label class="field-label" for="sso-issuer">Issuer</label>
      <div class="sso-inline">
        <input id="sso-issuer" class="field-input" v-model="form.issuer" placeholder="https://accounts.google.com" spellcheck="false" />
        <button class="btn" :disabled="testing || !form.issuer.trim()" @click="testDiscovery">
          <Icon name="refresh" :size="15" />{{ testing ? t('settings.testing') : t('settings.sso.testDiscovery') }}
        </button>
      </div>
    </div>
    <div v-if="testResult" class="sso-test" :class="testResult.ok ? 'sso-test-ok' : 'sso-test-err'">
      <template v-if="testResult.ok">
        <div><Icon name="check" :size="14" /> {{ t('settings.sso.discoveryOk', { issuer: testResult.issuer }) }}</div>
        <div>authorize: <code>{{ testResult.authorizationEndpoint }}</code></div>
        <div>token: <code>{{ testResult.tokenEndpoint }}</code> ({{ testResult.tokenAuthMethod }})</div>
        <div>jwks: <code>{{ testResult.jwksUri }}</code></div>
        <div v-if="!testResult.pkce">{{ t('settings.sso.noPkce') }}</div>
      </template>
      <div v-else><Icon name="alert" :size="14" /> {{ testResult.error }}</div>
    </div>
    <div class="modal-row">
      <div class="field">
        <label class="field-label" for="sso-client">Client ID</label>
        <input id="sso-client" class="field-input" v-model="form.clientId" autocomplete="off" spellcheck="false" />
      </div>
      <div class="field">
        <label class="field-label" for="sso-secret">Client secret</label>
        <input
          id="sso-secret" class="field-input" type="password" v-model="form.clientSecret" autocomplete="new-password"
          :placeholder="settings?.clientSecretSet ? t('settings.sso.secretKept') : ''"
        />
      </div>
    </div>
    <div class="modal-row">
      <div class="field">
        <label class="field-label" for="sso-scopes">Scopes</label>
        <input id="sso-scopes" class="field-input" v-model="form.scopes" spellcheck="false" />
      </div>
      <div class="field">
        <label class="field-label" for="sso-claim">{{ t('settings.sso.usernameClaim') }}</label>
        <input id="sso-claim" class="field-input" v-model="form.usernameClaim" placeholder="preferred_username" spellcheck="false" />
      </div>
    </div>
    <div class="modal-row">
      <div class="field">
        <label class="field-label" for="sso-label">{{ t('settings.sso.buttonText') }}</label>
        <input id="sso-label" class="field-input" v-model="form.buttonLabel" maxlength="64" />
      </div>
      <div class="field">
        <label class="field-label" for="sso-group">{{ t('settings.sso.adminGroup') }}</label>
        <input id="sso-group" class="field-input" v-model="form.adminGroup" :placeholder="t('settings.sso.optional')" spellcheck="false" />
      </div>
    </div>
    <div class="field">
      <label class="field-label" for="sso-domains">{{ t('settings.sso.allowedDomains') }}</label>
      <input id="sso-domains" class="field-input" v-model="form.allowedDomains" :placeholder="t('settings.sso.allowedDomainsPlaceholder')" spellcheck="false" />
    </div>
    <div class="field">
      <label class="field-label"><input type="checkbox" v-model="form.autoProvision" /> {{ t('settings.sso.autoProvisionLabel') }}</label>
      <div class="sso-desc">{{ t('settings.sso.autoProvisionHint') }}</div>
    </div>
    <div class="field">
      <label class="field-label"><input type="checkbox" v-model="form.disablePasswordLogin" /> {{ t('settings.sso.disablePassword') }}</label>
      <div class="sso-desc">{{ t('settings.sso.disablePasswordHint') }}</div>
    </div>
    <div v-if="formError" class="sso-error">{{ formError }}</div>
    <template #foot>
      <button class="btn" @click="editing = false">{{ t('common.cancel') }}</button>
      <button class="btn btn-primary" :disabled="saving" @click="save">{{ saving ? t('settings.saving') : t('common.save') }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.sso-card {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding: 14px 16px; margin-bottom: 18px;
  border: 1px solid var(--line-2, rgba(255,255,255,.1)); border-radius: 12px;
  background: var(--bg-0, rgba(255,255,255,.02));
}
.sso-ic {
  flex: none; width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center;
  color: var(--neon, #2dd4ff); background: color-mix(in srgb, var(--neon, #2dd4ff) 14%, transparent);
}
.sso-main { flex: 1; min-width: 220px; }
.sso-title { font-weight: 600; margin-bottom: 3px; display: flex; align-items: center; gap: 8px; }
.sso-tag {
  font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em;
  padding: 2px 7px; border-radius: 999px; border: 1px solid currentColor; line-height: 1.4;
}
.sso-on { color: var(--green, #3ddc97); }
.sso-off { color: var(--text-3, #9aa4b2); }
.sso-desc { font-size: 12.5px; line-height: 1.5; color: var(--text-3, #9aa4b2); }
.sso-redirect { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
.sso-redirect code, .sso-test code { font-family: ui-monospace, monospace; font-size: 12px; word-break: break-all; }
.sso-acts { display: flex; gap: 8px; flex-wrap: wrap; flex: none; }
.sso-inline { display: flex; gap: 8px; }
.sso-inline .field-input { flex: 1; min-width: 0; }
.sso-inline .btn { flex: none; }
.sso-test {
  display: grid; gap: 3px; margin: -4px 0 14px; padding: 10px 12px; border-radius: 9px; font-size: 12.5px;
  border: 1px solid currentColor;
}
.sso-test-ok { color: var(--green, #3ddc97); }
.sso-test-err { color: var(--danger); }
.sso-error { color: var(--danger); font-size: 13px; }
</style>
