<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { Bucket, Connection } from '../core/models';
import { api, apiErrMsg, ApiError } from '../core/api';
import { useToast } from '../core/toast';
import { fmtBytes, bucketLabel, canDeleteBucket } from '../core/util';
import Icon from '../components/Icon.vue';
import PermBadge from '../components/PermBadge.vue';
import Modal from '../components/Modal.vue';
import InputModal from '../components/InputModal.vue';
import ContextMenu, { type MenuItem } from '../components/ContextMenu.vue';
import { t, fmtNumber } from '../i18n';

const props = defineProps<{ query: string; isAdmin?: boolean }>();
const emit = defineEmits<{ open: [bucket: Bucket]; goSettings: []; loaded: [buckets: Bucket[]] }>();
const toast = useToast();

const buckets = ref<Bucket[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const notConfigured = ref(false);
const showNew = ref(false);
const conns = ref<Connection[]>([]);
const newName = ref('');
const newConn = ref('');
const newEncrypted = ref(false);

const menu = ref<{ x: number; y: number; bucket: Bucket } | null>(null);
const renaming = ref<Bucket | null>(null);
const deleting = ref<Bucket | null>(null);

const menuItems = computed<MenuItem[]>(() => {
  const b = menu.value?.bucket;
  if (!b) return [];
  return [
    { key: 'rename', label: t('buckets.menuRename'), icon: 'edit' },
    { key: 'copy', label: t('buckets.menuCopy'), icon: 'copy' },
    { key: 'delete', label: t('buckets.menuDelete'), icon: 'trash', danger: true, disabled: !canDeleteBucket(b) },
  ];
});

const visible = computed(() => {
  const q = props.query.trim().toLowerCase();
  return q ? buckets.value.filter((b) =>
    (b.name ?? b.id).toLowerCase().includes(q) ||
    (b.connection ?? '').toLowerCase().includes(q) ||
    b.region.toLowerCase().includes(q)) : buckets.value;
});

async function openNew() {
  newName.value = '';
  newEncrypted.value = false;
  try { conns.value = await api.connections(); } catch { conns.value = []; }
  newConn.value = conns.value[0]?.id ?? '';
  showNew.value = true;
}

async function reload() {
  loading.value = true; error.value = null; notConfigured.value = false;
  try { buckets.value = (await api.buckets()) ?? []; }
  catch (e) {
    if (e instanceof ApiError && e.status === 503) notConfigured.value = true;
    else error.value = apiErrMsg(e);
  }
  loading.value = false;
  emit('loaded', buckets.value);
  loadStats();
}
onMounted(reload);
defineExpose({ reload });

// Fill in real usage (size + object count) per card, asynchronously, so the grid
// shows immediately and the numbers land as each bucket is tallied server-side.
function loadStats() {
  for (const b of buckets.value) {
    b.statsLoading = true;
    api.bucketStats(b.id)
      .then((s) => { b.used = s.used; b.objects = s.objects; b.statsTruncated = s.truncated; })
      .catch(() => { /* leave as unknown */ })
      .finally(() => { b.statsLoading = false; });
  }
}

async function create() {
  const name = newName.value.trim();
  if (!name || !newConn.value) { toast.error(t('buckets.chooseConnAndName')); return; }
  showNew.value = false;
  try { await api.createBucket(newConn.value, name, newEncrypted.value); toast.success(t(newEncrypted.value ? 'buckets.createdEncrypted' : 'buckets.created', { name })); reload(); }
  catch (e) { toast.error(apiErrMsg(e, 'create')); }
}

const objstr = (n?: number) => (n != null ? fmtNumber(n) : '—');
const accent = (b: Bucket) => b.color === 'green' ? 'var(--green)' : b.color === 'amber' ? 'var(--amber)' : 'var(--neon)';

function openMenu(e: MouseEvent, b: Bucket) {
  menu.value = { x: e.clientX, y: e.clientY, bucket: b };
}
function onMenu(key: string) {
  const b = menu.value?.bucket; menu.value = null;
  if (!b) return;
  if (key === 'rename') renaming.value = b;
  else if (key === 'copy') {
    navigator.clipboard.writeText(b.name ?? b.id)
      .then(() => toast.success(t('buckets.nameCopied')))
      .catch(() => toast.error(t('buckets.copyFailed')));
  } else if (key === 'delete') {
    if (canDeleteBucket(b)) deleting.value = b;
  }
}
async function saveAlias(value: string) {
  const b = renaming.value; renaming.value = null;
  if (!b) return;
  try {
    const r = await api.setBucketAlias(b.id, value);
    b.alias = r.alias ?? undefined;
    toast.success(t('buckets.aliasUpdated'));
  } catch (e) { toast.error(apiErrMsg(e, 'save')); }
}
async function confirmDelete() {
  const b = deleting.value; deleting.value = null;
  if (!b) return;
  try {
    await api.deleteBucket(b.id);
    buckets.value = buckets.value.filter((x) => x.id !== b.id);
    toast.success(t('buckets.deleted'));
  } catch (e) {
    const msg = e instanceof ApiError && e.status === 409
      ? t('buckets.mustBeEmpty')
      : apiErrMsg(e, 'delete');
    toast.error(msg);
  }
}
</script>

<template>
  <div class="view">
    <div class="view-head">
      <div>
        <h1 class="view-title">{{ t('buckets.title') }}</h1>
        <p class="view-sub">{{ t('buckets.subtitle', { count: buckets.length }) }}</p>
      </div>
      <button v-if="isAdmin" class="btn btn-primary" @click="openNew"><Icon name="plus" :size="16" />{{ t('buckets.newBucket') }}</button>
    </div>

    <Modal v-if="showNew" :title="t('buckets.newBucket')" icon="database" @close="showNew = false">
      <div v-if="conns.length === 0" class="modal-hint" style="color:var(--danger)">
        {{ t('buckets.noConnections') }}
      </div>
      <template v-else>
        <div class="field">
          <label class="field-label">{{ t('buckets.connection') }}</label>
          <select class="modal-input" v-model="newConn">
            <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div class="field">
          <label class="field-label">{{ t('buckets.bucketName') }}</label>
          <input class="field-input" v-model="newName" :placeholder="t('buckets.namePlaceholder')" @keydown.enter="create" />
        </div>
        <label class="enc-opt" :class="{ on: newEncrypted }">
          <input type="checkbox" v-model="newEncrypted" class="enc-opt-check" />
          <span class="enc-opt-body">
            <span class="enc-opt-title"><Icon name="lock" :size="15" /> {{ t('buckets.encryptTitle') }}</span>
            <span class="enc-opt-desc">
              {{ t('buckets.encryptDescBefore') }}<b>{{ t('buckets.encryptDescStrong') }}</b>{{ t('buckets.encryptDescAfter') }}
            </span>
          </span>
        </label>
      </template>
      <template #foot>
        <button class="btn" @click="showNew = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="conns.length === 0" @click="create"><Icon name="check" :size="16" />{{ t('buckets.createBucket') }}</button>
      </template>
    </Modal>

    <div v-if="loading" class="loading"><div class="spinner"></div>{{ t('buckets.loadingCluster') }}</div>

    <div v-else-if="notConfigured" class="errbox">
      <Icon name="cpu" :size="32" />
      <div class="errbox-title">{{ t('buckets.notConfiguredTitle') }}</div>
      <div class="errbox-sub">
        {{ isAdmin
          ? t('buckets.notConfiguredAdmin')
          : t('buckets.notConfiguredUser') }}
      </div>
      <button v-if="isAdmin" class="btn btn-primary" @click="emit('goSettings')">
        <Icon name="cpu" :size="15" />{{ t('buckets.goSettings') }}
      </button>
    </div>

    <div v-else-if="error" class="errbox">
      <Icon name="alert" :size="32" />
      <div class="errbox-title">{{ t('buckets.loadFailed') }}</div>
      <div class="errbox-sub">{{ error }}</div>
      <button class="btn" @click="reload"><Icon name="refresh" :size="15" />{{ t('buckets.tryAgain') }}</button>
    </div>

    <template v-else>

      <div v-if="visible.length === 0" class="empty">{{ query ? t('buckets.noMatch') : t('buckets.noneAvailable') }}</div>
      <div v-else class="bgrid">
        <button v-for="b in visible" :key="b.id" class="bcard" :style="{ '--accent': accent(b) }"
                @click="emit('open', b)" @contextmenu.prevent="openMenu($event, b)">
          <div class="bcard-top">
            <div class="bcard-icon"><Icon name="database" :size="22" /></div>
            <div class="bcard-conn">{{ bucketLabel(b) }}</div>
            <PermBadge :perm="b.perm" :small="true" />
          </div>
          <div v-if="b.alias?.trim()" class="bcard-name">{{ b.name ?? b.id }}</div>
          <div class="bcard-region">
            {{ b.connection ? b.connection + ' · ' : '' }}{{ b.region }}
            <span v-if="b.encrypted" class="bcard-enc" :title="t('buckets.encryptedTitle')"><Icon name="lock" :size="11" /> {{ t('buckets.encrypted') }}</span>
          </div>
          <div class="bcard-tiles">
            <div class="bcard-tile">
              <span class="bcard-tile-val">
                <span v-if="b.statsLoading" class="bcard-skel"></span>
                <template v-else>{{ b.used != null ? fmtBytes(b.used) : '—' }}<i v-if="b.statsTruncated">+</i></template>
              </span>
              <em>{{ t('buckets.stored') }}</em>
            </div>
            <div class="bcard-tile">
              <span class="bcard-tile-val">
                <span v-if="b.statsLoading" class="bcard-skel"></span>
                <template v-else>{{ objstr(b.objects) }}<i v-if="b.statsTruncated">+</i></template>
              </span>
              <em>{{ t('buckets.objects') }}</em>
            </div>
          </div>
        </button>
      </div>
    </template>

    <ContextMenu v-if="menu" :x="menu.x" :y="menu.y" :items="menuItems"
                 @select="onMenu" @close="menu = null" />

    <InputModal v-if="renaming" :title="t('buckets.menuRename')" icon="edit"
                :initial="renaming.alias ?? ''" :placeholder="t('buckets.aliasPlaceholder')"
                :hint="t('buckets.aliasHint')" :confirm-label="t('common.save')"
                @confirm="saveAlias" @close="renaming = null" />

    <Modal v-if="deleting" :title="t('buckets.deleteTitle')" icon="trash" @close="deleting = null">
      <div class="modal-hint">
        {{ t('buckets.deleteConfirmBefore') }}<strong>{{ deleting.name ?? deleting.id }}</strong>{{ t('buckets.deleteConfirmAfter') }}
      </div>
      <template #foot>
        <button class="btn" @click="deleting = null">{{ t('common.cancel') }}</button>
        <button class="btn btn-danger" @click="confirmDelete"><Icon name="trash" :size="16" />{{ t('common.delete') }}</button>
      </template>
    </Modal>
  </div>
</template>
