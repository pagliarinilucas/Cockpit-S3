<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { ref } from 'vue';
import { api, ApiError } from '../core/api';
import Icon from '../components/Icon.vue';

const emit = defineEmits<{ loggedIn: [] }>();
const username = ref('');
const password = ref('');
const busy = ref(false);
const error = ref<string | null>(null);

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
      ? 'API indisponível (porta 3000).' : 'Usuário ou senha inválidos.';
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
        <div class="brand-mark"><Icon name="gauge" :size="24" /></div>
        <div>
          <div class="login-title">COCKPIT S3</div>
          <div class="login-sub">STORAGE CONSOLE</div>
        </div>
      </div>
      <form @submit.prevent="submit">
        <div class="field">
          <label class="field-label">Usuário</label>
          <input class="field-input" v-model="username" autofocus autocomplete="username" />
        </div>
        <div class="field">
          <label class="field-label">Senha</label>
          <input class="field-input" type="password" v-model="password" autocomplete="current-password" />
        </div>
        <div v-if="error" class="login-error"><Icon name="alert" :size="14" />{{ error }}</div>
        <button type="submit" class="btn btn-primary login-btn" :disabled="busy">
          <Icon name="power" :size="16" />{{ busy ? 'Conectando…' : 'Conectar' }}
        </button>
      </form>
    </div>
  </div>
</template>
