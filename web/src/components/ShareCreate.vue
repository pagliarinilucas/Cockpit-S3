<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { ref } from 'vue';
import { api, apiErrMsg } from '../core/api';
import { useToast } from '../core/toast';
import Modal from './Modal.vue';
import Icon from './Icon.vue';
import { t, fmtDateTime } from '../i18n';

const props = defineProps<{ bucketId: string; objKey: string; filename: string }>();
const emit = defineEmits<{ close: [] }>();
const toast = useToast();

const DURATIONS = [
  { v: 3600, key: 'share.create.durations.hour' },
  { v: 86400, key: 'share.create.durations.day' },
  { v: 604800, key: 'share.create.durations.week' },
  { v: 2592000, key: 'share.create.durations.month' },
] as const;

const ttl = ref(604800);        // padrão 7 dias
const lockIp = ref(false);
const creating = ref(false);
const error = ref<string | null>(null);
const link = ref<string | null>(null);
const expiresAt = ref<string | null>(null);

const fmtDate = (iso: string) => fmtDateTime(iso, '—');

async function create() {
  if (creating.value) return;
  creating.value = true; error.value = null;
  try {
    const r = await api.createShare(props.bucketId, props.objKey, ttl.value, lockIp.value);
    link.value = `${window.location.origin}/s/${r.token}`;
    expiresAt.value = r.expiresAt;
    toast.success(t('share.create.created'));
  } catch (e) {
    error.value = apiErrMsg(e, 'createLink');
  } finally {
    creating.value = false;
  }
}

async function copy() {
  if (!link.value) return;
  try { await navigator.clipboard.writeText(link.value); toast.info(t('share.copied')); }
  catch { toast.error(t('share.copyFailed')); }
}
</script>

<template>
  <Modal :title="t('share.create.title')" icon="share" @close="emit('close')">
    <p class="modal-text">{{ t('share.create.intro') }} <strong>{{ filename }}</strong>.</p>

    <template v-if="!link">
      <div class="field" style="margin-top:12px">
        <label class="field-label"><Icon name="clock" :size="14" /> {{ t('share.create.expiresIn') }}</label>
        <select class="modal-input" v-model.number="ttl">
          <option v-for="d in DURATIONS" :key="d.v" :value="d.v">{{ t(d.key) }}</option>
        </select>
      </div>

      <label class="share-check">
        <input type="checkbox" v-model="lockIp" />
        <span class="cbox"><Icon name="check" :size="12" /></span>
        <span><Icon name="lock" :size="13" /> {{ t('share.create.lockIp') }}</span>
      </label>
      <p class="modal-hint">{{ t('share.create.lockIpHint') }}</p>

      <p v-if="error" class="modal-hint" style="color:var(--danger)">{{ error }}</p>
    </template>

    <template v-else>
      <div class="share-result">
        <label class="field-label"><Icon name="link" :size="14" /> {{ t('share.create.publicLink') }}</label>
        <div class="share-linkbox">
          <input class="modal-input" :value="link" readonly @focus="($event.target as HTMLInputElement).select()" />
          <button class="btn btn-primary" @click="copy"><Icon name="copy" :size="16" />{{ t('common.copy') }}</button>
        </div>
        <p class="modal-hint" v-if="expiresAt"><Icon name="clock" :size="13" /> {{ t('share.create.expiresAt', { date: fmtDate(expiresAt) }) }}</p>
      </div>
    </template>

    <template #foot>
      <button class="btn" @click="emit('close')">{{ link ? t('common.close') : t('common.cancel') }}</button>
      <button v-if="!link" class="btn btn-primary" :disabled="creating" @click="create">
        <Icon name="share" :size="16" />{{ creating ? t('share.create.creating') : t('share.create.createLink') }}
      </button>
    </template>
  </Modal>
</template>
