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
import { useBranding } from '../core/branding';

const { branding, productName } = useBranding();

const emit = defineEmits<{ loggedIn: [] }>();
const username = ref('');
const password = ref('');
const busy = ref(false);
const error = ref<string | null>(null);
const sso = ref<OidcPublicInfo | null>(null);
const showPasswordForm = ref(false);

const SSO_ERRORS: Record<string, string> = {
  disabled: 'O login via SSO não está habilitado nesta instância.',
  discovery: 'Não foi possível contatar o provedor de identidade. Tente novamente em instantes.',
  idp: 'O provedor de identidade recusou ou cancelou o login.',
  state: 'A tentativa de login expirou ou não pôde ser validada. Tente novamente.',
  token: 'Não foi possível validar a resposta do provedor de identidade.',
  no_username: 'O provedor de identidade não informou um nome de usuário.',
  domain: 'Seu e-mail não pertence a um domínio autorizado.',
  not_provisioned: 'Sua conta ainda não existe no Cockpit S3. Peça acesso a um administrador.',
  inactive: 'Sua conta está desativada. Fale com um administrador.',
};

const ssoEnabled = computed(() => !!sso.value?.enabled);
const passwordVisible = computed(() => !ssoEnabled.value || sso.value?.passwordLogin !== false || showPasswordForm.value);

function consumeSsoError() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('sso_error');
  if (!code) return;
  error.value = SSO_ERRORS[code] ?? 'Não foi possível entrar com SSO.';
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
  if (!username.value || !password.value) { error.value = 'Informe usuário e senha.'; return; }
  busy.value = true;
  error.value = null;
  try {
    await api.login(username.value, password.value);
    password.value = '';
    emit('loggedIn');
  } catch (e) {
    error.value = e instanceof ApiError && e.status === 0
      ? 'API indisponível (porta 3000).'
      : e instanceof ApiError && e.status === 403
        ? 'O login com senha está desativado para sua conta. Use o SSO.'
        : 'Usuário ou senha inválidos.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <div class="login-grid"></div>
    <div class="login-card">
      <div class="login-brand">
        <BrandMark :size="24" />
        <div>
          <div class="login-title">{{ branding.active ? productName : 'COCKPIT S3' }}</div>
          <div class="login-sub">STORAGE CONSOLE</div>
        </div>
      </div>
      <template v-if="ssoEnabled">
        <button type="button" class="btn btn-primary login-btn" :disabled="busy" @click="startSso">
          <Icon name="shield" :size="16" />{{ sso!.buttonLabel }}
        </button>
        <div v-if="error && !passwordVisible" class="login-error sso-error"><Icon name="alert" :size="14" />{{ error }}</div>
        <div v-if="passwordVisible" class="sso-divider"><span>ou</span></div>
        <button v-else type="button" class="sso-toggle" @click="showPasswordForm = true">
          Entrar com usuário e senha
        </button>
      </template>
      <form v-if="passwordVisible" @submit.prevent="submit">
        <div class="field">
          <label class="field-label">Usuário</label>
          <input class="field-input" v-model="username" :autofocus="!ssoEnabled" autocomplete="username" />
        </div>
        <div class="field">
          <label class="field-label">Senha</label>
          <input class="field-input" type="password" v-model="password" autocomplete="current-password" />
        </div>
        <div v-if="error" class="login-error"><Icon name="alert" :size="14" />{{ error }}</div>
        <button type="submit" class="btn login-btn" :class="{ 'btn-primary': !ssoEnabled }" :disabled="busy">
          <Icon name="power" :size="16" />{{ busy ? 'Conectando…' : 'Conectar' }}
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
</style>
