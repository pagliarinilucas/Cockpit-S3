<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api, ApiError, type OidcPublicInfo } from '../core/api';
import Icon from '../components/Icon.vue';
import BrandMark from '../components/BrandMark.vue';
import PoweredBy from '../components/PoweredBy.vue';
import DemoNotice from '../components/DemoNotice.vue';
import { useBranding } from '../core/branding';
import LocaleSwitcher from '../components/LocaleSwitcher.vue';
import { t } from '../i18n';
import type { Catalog } from '../i18n/catalog';

const { branding, productName } = useBranding();

const emit = defineEmits<{ loggedIn: [] }>();
const username = ref('');
const password = ref('');
const busy = ref(false);
const error = ref<string | null>(null);
const sso = ref<OidcPublicInfo | null>(null);
const showPasswordForm = ref(false);

type SsoErrorCode = keyof Catalog['auth']['ssoErrors'];
const SSO_ERROR_CODES: SsoErrorCode[] = ['disabled', 'discovery', 'idp', 'state', 'token', 'no_username', 'domain', 'not_provisioned', 'inactive'];
const isSsoErrorCode = (code: string): code is SsoErrorCode => (SSO_ERROR_CODES as string[]).includes(code);

const ssoEnabled = computed(() => !!sso.value?.enabled);
const passwordVisible = computed(() => !ssoEnabled.value || sso.value?.passwordLogin !== false || showPasswordForm.value);

function consumeSsoError() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('sso_error');
  if (!code) return;
  error.value = isSsoErrorCode(code) ? t(`auth.ssoErrors.${code}`) : t('auth.ssoFailed');
  url.searchParams.delete('sso_error');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}

onMounted(async () => {
  consumeSsoError();
  try { sso.value = await api.oidcPublic(); } catch { sso.value = null; }
});

function startSso() {
  busy.value = true;
  window.location.href = '/api/auth/oidc/login';
}

async function submit() {
  if (!username.value || !password.value) { error.value = t('auth.missingCredentials'); return; }
  busy.value = true;
  error.value = null;
  try {
    await api.login(username.value, password.value);
    password.value = '';
    emit('loggedIn');
  } catch (e) {
    error.value = e instanceof ApiError && e.status === 0
      ? t('auth.apiUnavailable')
      : e instanceof ApiError && e.status === 403
        ? t('auth.passwordDisabled')
        : t('auth.invalidCredentials');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <div class="login-grid"></div>
    <div class="login-card">
      <LocaleSwitcher class="login-locale" />
      <div class="login-brand">
        <BrandMark :size="24" />
        <div>
          <div class="login-title">{{ branding.active ? productName : 'COCKPIT S3' }}</div>
          <div class="login-sub">{{ t('auth.subtitle') }}</div>
        </div>
      </div>
      <template v-if="ssoEnabled">
        <button type="button" class="btn btn-primary login-btn" :disabled="busy" @click="startSso">
          <Icon name="shield" :size="16" />{{ sso!.buttonLabel }}
        </button>
        <div v-if="error && !passwordVisible" class="login-error sso-error"><Icon name="alert" :size="14" />{{ error }}</div>
        <div v-if="passwordVisible" class="sso-divider"><span>{{ t('auth.or') }}</span></div>
        <button v-else type="button" class="sso-toggle" @click="showPasswordForm = true">
          {{ t('auth.usePassword') }}
        </button>
      </template>
      <DemoNotice @use="(demoUser, demoPassword) => { username = demoUser; password = demoPassword; }" />
      <form v-if="passwordVisible" @submit.prevent="submit">
        <div class="field">
          <label class="field-label">{{ t('auth.username') }}</label>
          <input class="field-input" v-model="username" :autofocus="!ssoEnabled" autocomplete="username" />
        </div>
        <div class="field">
          <label class="field-label">{{ t('auth.password') }}</label>
          <input class="field-input" type="password" v-model="password" autocomplete="current-password" />
        </div>
        <div v-if="error" class="login-error"><Icon name="alert" :size="14" />{{ error }}</div>
        <button type="submit" class="btn login-btn" :class="{ 'btn-primary': !ssoEnabled }" :disabled="busy">
          <Icon name="power" :size="16" />{{ busy ? t('auth.connecting') : t('auth.connect') }}
        </button>
      </form>
      <PoweredBy />
    </div>
  </div>
</template>

<style scoped>
.sso-divider {
  display: flex; align-items: center; gap: 10px; margin: 16px 0 12px;
  font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--text-3, #9aa4b2);
}
.sso-divider::before, .sso-divider::after { content: ''; flex: 1; height: 1px; background: var(--line-2, rgba(255,255,255,.1)); }
.sso-toggle {
  display: block; margin: 14px auto 0; padding: 4px 8px; border: 0; background: none; cursor: pointer;
  font-size: 12.5px; color: var(--text-3, #9aa4b2); text-decoration: underline; text-underline-offset: 3px;
}
.sso-toggle:hover { color: var(--text-1, inherit); }
.sso-error { margin: 14px 0 0; }
.login-locale { position: absolute; top: 14px; right: 14px; }
</style>
