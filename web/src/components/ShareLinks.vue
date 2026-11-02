<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { Share } from '../core/models';
import { api, apiErrMsg } from '../core/api';
import { useToast } from '../core/toast';
import { timeAgoPhrase } from '../core/util';
import Modal from './Modal.vue';
import Icon from './Icon.vue';
import { t, fmtDateTime } from '../i18n';

const emit = defineEmits<{ close: [] }>();
const toast = useToast();

const shares = ref<Share[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const revoking = ref<string | null>(null);


async function load() {
  loading.value = true; error.value = null;
  try { shares.value = (await api.listShares()) ?? []; }
  catch (e) { error.value = apiErrMsg(e); }
  finally { loading.value = false; }
}
onMounted(load);

const fileName = (s: Share) => s.key.split('/').pop() || s.key;

const fmtDate = (iso: string) => fmtDateTime(iso, '—');

function ipLabel(s: Share): string {
  if (s.boundIp) return s.boundIp;
  if (s.lockIp) return t('share.links.awaitingFirstAccess');
  return '—';
}

async function copy(s: Share) {
  try {
    await navigator.clipboard.writeText(`${window.location.origin}/s/${s.token}`);
    toast.info(t('share.copied'));
  } catch { toast.error(t('share.copyFailed')); }
}

async function revoke(s: Share) {
  if (revoking.value) return;
  revoking.value = s.token;
  try { await api.revokeShare(s.token); toast.success(t('share.links.revoked')); await load(); }
  catch (e) { toast.error(apiErrMsg(e, 'revoke')); }
  finally { revoking.value = null; }
}
</script>

<template>
  <Modal :title="t('share.links.title')" icon="link" wide @close="emit('close')">
    <div v-if="loading" class="loading"><div class="spinner"></div>{{ t('share.links.loading') }}</div>
    <div v-else-if="error" class="errbox">
      <Icon name="alert" :size="28" />
      <div class="errbox-title">{{ t('share.links.loadFailed') }}</div>
      <div class="errbox-sub">{{ error }}</div>
      <button class="btn" @click="load"><Icon name="refresh" :size="15" />{{ t('share.links.tryAgain') }}</button>
    </div>
    <p v-else-if="!shares.length" class="modal-hint">{{ t('share.links.empty') }}</p>

    <div v-else class="share-list">
      <div v-for="s in shares" :key="s.token" class="share-row">
        <div class="share-row-main">
          <div class="share-row-name" :title="s.key"><Icon name="file" :size="14" /> {{ fileName(s) }}</div>
          <span class="share-badge" :class="'share-' + s.status">{{ t(`share.links.status.${s.status}`) }}</span>
        </div>
        <div class="share-row-meta">
          <span :title="t('share.links.bucket')"><Icon name="database" :size="12" /> {{ s.bucketId }}</span>
          <span class="dot-sep">·</span>
          <span :title="t('share.links.createdTitle')">{{ t('share.links.created', { time: timeAgoPhrase(s.createdAt) }) }}</span>
          <span class="dot-sep">·</span>
          <span :title="t('share.links.expiresTitle')"><Icon name="clock" :size="12" /> {{ t('share.links.expires', { date: fmtDate(s.expiresAt) }) }}</span>
          <span class="dot-sep">·</span>
          <span :title="t('share.links.lockedIpTitle')"><Icon name="lock" :size="12" /> {{ ipLabel(s) }}</span>
        </div>
        <div class="share-row-acts">
          <button class="iconbtn" :title="t('share.links.copyLink')" :aria-label="t('share.links.copyLink')" @click="copy(s)"><Icon name="copy" :size="15" /></button>
          <button v-if="s.status === 'active'" class="iconbtn iconbtn-danger" :title="t('share.links.revoke')" :aria-label="t('share.links.revoke')"
                  :disabled="revoking === s.token" @click="revoke(s)"><Icon name="x" :size="15" /></button>
        </div>
      </div>
    </div>
  </Modal>
</template>
