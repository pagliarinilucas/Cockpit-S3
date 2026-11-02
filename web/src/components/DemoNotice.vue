<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { t } from '../i18n';

interface DemoAccount { username: string; password: string; role: string; description: string }
interface DemoInfo { enabled: boolean; resetMinutes?: number; nextResetAt?: string | null; accounts?: DemoAccount[] }

const REPOSITORY_URL = 'https://github.com/pagliarinilucas/Cockpit-S3';
const CLOCK_TICK_MS = 30_000;

const props = withDefaults(defineProps<{ variant?: 'login' | 'banner' }>(), { variant: 'login' });
const emit = defineEmits<{ use: [username: string, password: string] }>();

const info = ref<DemoInfo | null>(null);
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | null = null;

async function loadDemoInfo() {
  try {
    const response = await fetch('/api/demo', { cache: 'no-store' });
    info.value = response.ok ? await response.json() as DemoInfo : null;
  } catch {
    info.value = null;
  }
}

const enabled = computed(() => !!info.value?.enabled);
const accounts = computed(() => info.value?.accounts ?? []);
const resetEvery = computed(() => {
  const minutes = info.value?.resetMinutes ?? 60;
  return minutes === 60 ? t('demo.everyHour') : t('demo.everyMinutes', { count: minutes });
});
const minutesToReset = computed(() => {
  const next = info.value?.nextResetAt;
  if (!next) return null;
  return Math.max(0, Math.ceil((Date.parse(next) - now.value) / 60_000));
});

function tick() {
  now.value = Date.now();
  const next = info.value?.nextResetAt;
  if (next && Date.parse(next) < now.value) void loadDemoInfo();
}

onMounted(async () => {
  await loadDemoInfo();
  if (enabled.value && props.variant === 'banner') clock = setInterval(tick, CLOCK_TICK_MS);
});
onBeforeUnmount(() => { if (clock) clearInterval(clock); });
</script>

<template>
  <div v-if="enabled && variant === 'banner'" class="demo-banner">
    <span class="demo-dot"></span>
    <span>
      {{ t('demo.banner', { every: resetEvery }) }}<template v-if="minutesToReset !== null">{{ t('demo.nextReset', { count: minutesToReset }) }}</template>.
    </span>
    <a :href="REPOSITORY_URL" target="_blank" rel="noopener">{{ t('demo.getIt') }}</a>
  </div>

  <section v-else-if="enabled" class="demo-login">
    <div class="demo-login-head">
      <span class="demo-dot"></span>
      <strong>{{ t('demo.title') }}</strong>
      <span class="demo-login-sub">{{ t('demo.subtitle', { every: resetEvery }) }}</span>
    </div>
    <ul class="demo-accounts">
      <li v-for="account in accounts" :key="account.username" class="demo-account">
        <div class="demo-account-text">
          <div class="demo-account-name">
            <code>{{ account.username }}</code> / <code>{{ account.password }}</code>
            <span class="demo-role">{{ account.role }}</span>
          </div>
          <div class="demo-account-desc">{{ account.description }}</div>
        </div>
        <button type="button" class="btn demo-use" @click="emit('use', account.username, account.password)">{{ t('demo.use') }}</button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.demo-dot {
  width: 7px; height: 7px; border-radius: 50%; flex: none;
  background: var(--amber, #f5a524); box-shadow: 0 0 8px var(--amber, #f5a524);
}
.demo-banner {
  flex: none; display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 8px 12px;
  padding: 6px 16px; font-size: 12.5px; color: var(--text-2);
  background: color-mix(in srgb, var(--amber, #f5a524) 10%, var(--bg-1));
  border-bottom: 1px solid color-mix(in srgb, var(--amber, #f5a524) 30%, transparent);
}
.demo-banner a { color: var(--neon); text-decoration: none; font-weight: 600; white-space: nowrap; }
.demo-banner a:hover { text-decoration: underline; }
.demo-login {
  margin: 0 0 22px; padding: 12px 14px; border-radius: 10px;
  border: 1px dashed color-mix(in srgb, var(--amber, #f5a524) 45%, transparent);
  background: color-mix(in srgb, var(--amber, #f5a524) 6%, transparent);
}
.demo-login-head { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 8px; }
.demo-login-sub { color: var(--text-3); font-size: 11.5px; }
.demo-accounts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.demo-account { display: flex; align-items: center; gap: 10px; }
.demo-account-text { flex: 1; min-width: 0; }
.demo-account-name { font-size: 12.5px; }
.demo-account-name code { font-family: var(--mono); font-size: 12px; }
.demo-role {
  margin-left: 6px; padding: 1px 6px; border-radius: 6px; font-family: var(--mono); font-size: 10px;
  text-transform: uppercase; letter-spacing: 1px; color: var(--text-3); border: 1px solid var(--line-2);
}
.demo-account-desc { font-size: 11.5px; color: var(--text-3); line-height: 1.35; margin-top: 2px; }
.demo-use { flex: none; padding: 4px 12px; font-size: 12px; }
</style>
