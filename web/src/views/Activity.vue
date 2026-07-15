<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { ActivityEvent, ActivityAction } from '../core/models';
import { api, apiErrMsg } from '../core/api';
import { timeAgo } from '../core/util';
import Icon from '../components/Icon.vue';

const props = defineProps<{ query: string }>();

const ACT_META: Record<ActivityAction, { icon: string; col: string; verb: string }> = {
  upload:   { icon: 'upload',   col: 'var(--neon)',   verb: 'enviou' },
  download: { icon: 'download', col: 'var(--green)',  verb: 'baixou' },
  delete:   { icon: 'trash',    col: 'var(--danger)', verb: 'excluiu' },
  grant:    { icon: 'shield',   col: 'var(--amber)',  verb: 'concedeu' },
  revoke:   { icon: 'x',        col: 'var(--danger)', verb: 'revogou' },
  key:      { icon: 'key',      col: 'var(--amber)',  verb: '' },
  bucket:   { icon: 'database', col: 'var(--neon)',   verb: '' },
  share:    { icon: 'share',    col: 'var(--neon)',   verb: 'compartilhou' },
};

const events = ref<ActivityEvent[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const filtered = computed(() => {
  const q = props.query.trim().toLowerCase();
  if (!q) return events.value;
  return events.value.filter((a) => (a.actor + a.bucket + a.target + a.action).toLowerCase().includes(q));
});

async function reload() {
  loading.value = true; error.value = null;
  try { events.value = (await api.activity()) ?? []; }
  catch (e) { error.value = apiErrMsg(e); }
  finally { loading.value = false; }
}
onMounted(reload);
defineExpose({ reload });

const meta = (a: ActivityEvent) => ACT_META[a.action] ?? ACT_META.bucket;
</script>

<template>
  <div class="view">
    <div class="view-head">
      <div>
        <h1 class="view-title">Atividade</h1>
        <p class="view-sub">Auditoria de acessos e operações no cluster</p>
      </div>
    </div>

    <div v-if="loading" class="loading"><div class="spinner"></div>CARREGANDO ATIVIDADE…</div>
    <div v-else-if="error" class="errbox">
      <Icon name="alert" :size="32" />
      <div class="errbox-title">Não foi possível carregar a atividade</div>
      <div class="errbox-sub">{{ error }}</div>
      <button class="btn" @click="reload"><Icon name="refresh" :size="15" />Tentar de novo</button>
    </div>
    <div v-else-if="filtered.length === 0" class="empty">{{ query ? 'Nenhum evento corresponde à busca.' : 'Nenhum evento registrado.' }}</div>
    <div v-else class="timeline">
      <div v-for="(a, i) in filtered" :key="i" class="tl-row">
        <div class="tl-icon" :style="{ '--c': meta(a).col }"><Icon :name="meta(a).icon" :size="15" /></div>
        <div class="tl-body">
          <div class="tl-main"><strong>{{ a.actor }}</strong> {{ meta(a).verb }} <span class="tl-target">{{ a.target }}</span></div>
          <div class="tl-meta">
            <span class="tl-bucket"><Icon name="database" :size="11" /> {{ a.bucket }}</span>
            <span class="dot-sep">·</span>{{ timeAgo(a.at) + ' atrás' }}
          </div>
        </div>
        <div class="tl-action-tag" :style="{ color: meta(a).col, borderColor: meta(a).col }">{{ a.action }}</div>
      </div>
    </div>
  </div>
</template>
