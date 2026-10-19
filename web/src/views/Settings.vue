<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { Connection, Cluster, ClusterInput } from '../core/models';
import { api, apiErrMsg, ApiError, type ConnectionPayload, type EscrowStatus } from '../core/api';
import { useToast } from '../core/toast';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';
import LicensePanel from '../components/settings/LicensePanel.vue';
import SsoPanel from '../components/settings/SsoPanel.vue';
import AuditPanel from '../components/settings/AuditPanel.vue';
import BrandingPanel from '../components/settings/BrandingPanel.vue';
import { t, fmtDateTime } from '../i18n';

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const toast = useToast();
const connections = ref<Connection[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

// editor modal state
const editing = ref<Connection | 'new' | null>(null);
const form = ref({ name: '', endpoint: '', region: 'garage', accessKey: '', secretKey: '', bucketsText: '' });
const secretSet = ref(false);
const testing = ref(false);
const saving = ref(false);
const testResult = ref<{ ok: boolean; buckets?: string[]; error?: string } | null>(null);

const toDelete = ref<Connection | null>(null);

// backup da KEK (disaster recovery, admin) — revela o segredo cru p/ o admin guardar num cofre
const kek = ref<{ version: number | null; fingerprint: string; kekBase64: string } | null>(null);
const kekLoading = ref(false);
const kekShown = ref(false);

async function revealKek() {
  kekLoading.value = true;
  try { kek.value = await api.getKek(); kekShown.value = true; }
  catch (e) {
    const msg = e instanceof ApiError && e.status === 400
      ? t('settings.kek.notConfigured')
      : apiErrMsg(e, 'revealKek');
    toast.error(msg);
  } finally { kekLoading.value = false; }
}
function closeKek() { kekShown.value = false; kek.value = null; }
function copyKek() {
  if (!kek.value) return;
  navigator.clipboard.writeText(kek.value.kekBase64)
    .then(() => toast.success(t('settings.kek.copied')))
    .catch(() => toast.error(t('settings.copyFailed')));
}
function downloadKek() {
  if (!kek.value) return;
  const body = [
    t('settings.kek.fileHeader'),
    t('settings.kek.fileWarn1'),
    t('settings.kek.fileWarn2'),
    t('settings.kek.fileVersion', { version: kek.value.version ?? '—' }),
    `# fingerprint: ${kek.value.fingerprint}`,
    kek.value.kekBase64,
    '',
  ].join('\n');
  const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `cockpit-kek-v${kek.value.version ?? 'x'}-${kek.value.fingerprint}.key`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

const escrow = ref<EscrowStatus | null>(null);
const escrowLoading = ref(true);
const escrowTesting = ref(false);
const escrowBackingUp = ref(false);

const escrowEditing = ref(false);
const escrowForm = ref({ enabled: false, endpoint: '', region: 'garage', accessKey: '', secretKey: '', bucket: '', prefix: '', vendorEnabled: false });
const escrowDestSet = ref(false);
const escrowSaving = ref(false);

const recoveryEditing = ref(false);
const recoveryManual = ref('');
const recoveryCode = ref<string | null>(null);
const recoveryGenerating = ref(false);
const recoveryAcking = ref(false);

async function loadEscrow() {
  escrowLoading.value = true;
  try { escrow.value = await api.escrowStatus(); }
  catch (e) { toast.error(apiErrMsg(e, 'loadBackupStatus')); }
  finally { escrowLoading.value = false; }
}

function openEscrowEdit() {
  const cfg = escrow.value;
  escrowDestSet.value = !!cfg?.clientDest;
  escrowForm.value = {
    enabled: cfg?.enabled ?? false,
    endpoint: cfg?.clientDest?.endpoint ?? '',
    region: cfg?.clientDest?.region ?? 'garage',
    accessKey: cfg?.clientDest?.accessKey ?? '',
    secretKey: '',
    bucket: cfg?.clientDest?.bucket ?? '',
    prefix: cfg?.clientDest?.prefix ?? '',
    vendorEnabled: cfg?.vendorEnabled ?? false,
  };
  escrowEditing.value = true;
}

async function saveEscrow() {
  const f = escrowForm.value;
  const destFilled = f.endpoint.trim() || f.accessKey.trim() || f.bucket.trim() || f.secretKey.trim();
  if (destFilled && (!f.endpoint.trim() || !f.accessKey.trim() || !f.bucket.trim() || !f.secretKey.trim())) {
    toast.error(t('settings.escrow.destRequired'));
    return;
  }
  if (f.enabled && !destFilled && !escrowDestSet.value) {
    toast.error(t('settings.escrow.destMissing'));
    return;
  }
  escrowSaving.value = true;
  try {
    await api.escrowConfig({
      enabled: f.enabled,
      vendorEnabled: f.vendorEnabled,
      clientDest: destFilled
        ? { endpoint: f.endpoint.trim(), region: f.region.trim() || 'garage', accessKey: f.accessKey.trim(), secretKey: f.secretKey, bucket: f.bucket.trim(), prefix: f.prefix.trim() }
        : undefined,
    });
    toast.success(t('settings.escrow.saved'));
    escrowEditing.value = false;
    await loadEscrow();
  } catch (e) { toast.error(apiErrMsg(e, 'saveBackupConfig')); }
  finally { escrowSaving.value = false; }
}

function openRecoveryEdit() {
  recoveryManual.value = '';
  recoveryCode.value = null;
  recoveryEditing.value = true;
}

async function genRecovery() {
  const manual = recoveryManual.value.trim();
  if (manual && manual.length < 12) {
    toast.error(t('settings.recovery.manualTooShort'));
    return;
  }
  recoveryGenerating.value = true;
  try {
    const { code } = await api.escrowGenRecovery(manual || undefined);
    recoveryCode.value = code;
    await loadEscrow();
  } catch (e) { toast.error(apiErrMsg(e, 'generateRecoveryCode')); }
  finally { recoveryGenerating.value = false; }
}

function copyRecoveryCode() {
  if (!recoveryCode.value) return;
  navigator.clipboard.writeText(recoveryCode.value)
    .then(() => toast.success(t('settings.recovery.copied')))
    .catch(() => toast.error(t('settings.copyFailed')));
}

async function ackRecovery() {
  recoveryAcking.value = true;
  try {
    await api.escrowAckRecovery();
    recoveryEditing.value = false;
    recoveryCode.value = null;
    await loadEscrow();
  } catch (e) { toast.error(apiErrMsg(e, 'confirm')); }
  finally { recoveryAcking.value = false; }
}

async function testEscrowDest() {
  escrowTesting.value = true;
  try { await api.escrowTest(); toast.success(t('settings.escrow.destOk')); }
  catch (e) { toast.error(apiErrMsg(e, 'testDestination')); }
  finally { escrowTesting.value = false; }
}

async function backupNow() {
  escrowBackingUp.value = true;
  try {
    const r = await api.escrowBackupNow();
    toast.success(t('settings.escrow.backupDone', { key: r.key, count: r.removed }));
    await loadEscrow();
  } catch (e) { toast.error(apiErrMsg(e, 'runBackup')); }
  finally { escrowBackingUp.value = false; }
}

function fmtDate(ts: string | null): string {
  if (!ts) return t('settings.never');
  return fmtDateTime(ts, t('settings.never'));
}

// clusters (admin)
const clusters = ref<Cluster[]>([]);
const clusterEditing = ref<Cluster | 'new' | null>(null);
const clusterForm = ref({ name: '', s3Endpoint: '', adminEndpoint: '', adminToken: '', region: 'garage' });
const clusterAdminConfigured = ref(false);
const clusterSaving = ref(false);
const clusterToDelete = ref<Cluster | null>(null);

// lista única: clusters (admin) primeiro, depois conexões S3 puras.
type Source = { kind: 'cluster'; data: Cluster } | { kind: 'conn'; data: Connection };
const sources = computed<Source[]>(() => [
  ...clusters.value.map((data) => ({ kind: 'cluster' as const, data })),
  ...connections.value.map((data) => ({ kind: 'conn' as const, data })),
]);

async function load() {
  loading.value = true; error.value = null;
  try {
    const [conns, cls] = await Promise.all([api.connections(), api.clusters()]);
    connections.value = conns; clusters.value = cls;
  } catch (e) { error.value = apiErrMsg(e); }
  finally { loading.value = false; }
}
onMounted(() => { load(); loadEscrow(); });
defineExpose({ reload: load });

function openNew() {
  editing.value = 'new';
  secretSet.value = false;
  testResult.value = null;
  form.value = { name: '', endpoint: '', region: 'garage', accessKey: '', secretKey: '', bucketsText: '' };
}
function openEdit(c: Connection) {
  editing.value = c;
  secretSet.value = c.secretSet;
  testResult.value = null;
  form.value = { name: c.name, endpoint: c.endpoint, region: c.region || 'garage', accessKey: c.accessKey, secretKey: '', bucketsText: c.buckets.join(', ') };
}

function payload(): ConnectionPayload {
  const f = form.value;
  return {
    name: f.name.trim(),
    endpoint: f.endpoint.trim(),
    region: f.region.trim() || 'garage',
    accessKey: f.accessKey.trim(),
    secretKey: f.secretKey ? f.secretKey : undefined, // omit = keep stored (on edit)
    buckets: f.bucketsText.split(/[,\n]/).map((x) => x.trim()).filter(Boolean),
  };
}

async function test() {
  testing.value = true; testResult.value = null;
  try {
    const id = editing.value && editing.value !== 'new' ? editing.value.id : undefined;
    testResult.value = await api.testConnection({ ...payload(), id });
  } catch (e) { testResult.value = { ok: false, error: apiErrMsg(e, 'test') }; }
  finally { testing.value = false; }
}

async function save() {
  const f = form.value;
  if (!f.name.trim() || !f.endpoint.trim() || !f.accessKey.trim() || (!f.secretKey && !secretSet.value)) {
    toast.error(t('settings.connections.required'));
    return;
  }
  saving.value = true;
  try {
    if (editing.value === 'new') {
      await api.createConnection(payload());
      toast.success(t('settings.connections.created'));
    } else if (editing.value) {
      await api.updateConnection(editing.value.id, payload());
      toast.success(t('settings.connections.updated'));
    }
    editing.value = null;
    await load();
  } catch (e) { toast.error(apiErrMsg(e, 'save')); }
  finally { saving.value = false; }
}

async function confirmDelete() {
  const c = toDelete.value; if (!c) return;
  toDelete.value = null;
  try { await api.deleteConnection(c.id); toast.success(t('settings.connections.removed', { name: c.name })); await load(); }
  catch (e) { toast.error(apiErrMsg(e, 'remove')); }
}

function openNewCluster() {
  clusterEditing.value = 'new';
  clusterAdminConfigured.value = false;
  clusterForm.value = { name: '', s3Endpoint: '', adminEndpoint: '', adminToken: '', region: 'garage' };
}
function openEditCluster(c: Cluster) {
  clusterEditing.value = c;
  clusterAdminConfigured.value = c.adminConfigured;
  clusterForm.value = { name: c.name, s3Endpoint: c.s3Endpoint, adminEndpoint: c.adminEndpoint, adminToken: '', region: c.region || 'garage' };
}

function clusterPayload(): ClusterInput {
  const f = clusterForm.value;
  return {
    name: f.name.trim(),
    s3Endpoint: f.s3Endpoint.trim(),
    adminEndpoint: f.adminEndpoint.trim(),
    adminToken: f.adminToken ? f.adminToken : undefined, // omit = keep stored (on edit)
    region: f.region.trim() || 'garage',
  };
}

async function saveCluster() {
  const f = clusterForm.value;
  if (!f.name.trim() || !f.s3Endpoint.trim() || !f.adminEndpoint.trim() || (!f.adminToken && !clusterAdminConfigured.value)) {
    toast.error(t('settings.clusters.required'));
    return;
  }
  clusterSaving.value = true;
  try {
    if (clusterEditing.value === 'new') {
      await api.createCluster(clusterPayload());
      toast.success(t('settings.clusters.created'));
    } else if (clusterEditing.value) {
      await api.updateCluster(clusterEditing.value.id, clusterPayload());
      toast.success(t('settings.clusters.updated'));
    }
    clusterEditing.value = null;
    await load();
  } catch (e) { toast.error(apiErrMsg(e, 'save')); }
  finally { clusterSaving.value = false; }
}

async function confirmDeleteCluster() {
  const c = clusterToDelete.value; if (!c) return;
  clusterToDelete.value = null;
  try { await api.deleteCluster(c.id); toast.success(t('settings.clusters.removed', { name: c.name })); await load(); }
  catch (e) { toast.error(apiErrMsg(e, 'remove')); }
}
</script>

<template>
  <div class="view settings">
    <div class="view-head">
      <div>
        <h1 class="view-title">{{ t('settings.title') }}</h1>
        <p class="view-sub">{{ t('settings.subtitle', { clusters: t('settings.clusterCount', { count: clusters.length }), connections: t('settings.connectionCount', { count: connections.length }) }) }}</p>
      </div>
      <div class="head-acts">
        <button class="btn btn-primary" @click="openNewCluster"><Icon name="plus" :size="16" />{{ t('settings.newCluster') }}</button>
        <button class="btn btn-primary" @click="openNew"><Icon name="plus" :size="16" />{{ t('settings.newConnection') }}</button>
      </div>
    </div>

    <LicensePanel />
    <SsoPanel />
    <AuditPanel />
    <BrandingPanel />

    <div class="kek-card">
      <div class="kek-ic"><Icon name="lock" :size="20" /></div>
      <div class="kek-main">
        <div class="kek-title">{{ t('settings.kek.title') }}</div>
        <div class="kek-desc" v-html="t('settings.kek.desc')"></div>
      </div>
      <button class="btn" :disabled="kekLoading" @click="revealKek">
        <Icon name="key" :size="16" />{{ kekLoading ? t('settings.kek.revealing') : t('settings.kek.reveal') }}
      </button>
    </div>

    <div class="kek-card escrow-card">
      <div class="kek-ic"><Icon name="shield" :size="20" /></div>
      <div class="kek-main">
        <div class="kek-title">{{ t('settings.escrow.title') }}</div>
        <div class="kek-desc" v-html="t('settings.escrow.desc')"></div>
        <div v-if="!escrowLoading && escrow" class="escrow-status">
          {{ t('settings.escrow.lastBackup', { date: fmtDate(escrow.lastBackupAt) }) }}{{ escrow.lastStatus ? ` (${escrow.lastStatus})` : '' }}
          · {{ t('settings.escrow.retained', { count: escrow.lastCount ?? 0 }) }}
          · {{ escrow.enabled ? t('settings.escrow.on') : t('settings.escrow.off') }}
          <template v-if="escrow.vendorAvailable">
            · {{ t(escrow.vendorEnabled ? 'settings.escrow.managedOn' : 'settings.escrow.managedAvailable', { fingerprint: escrow.vendorFingerprint ?? '' }) }}
          </template>
          <template v-else> · {{ t('settings.escrow.managedUnavailable') }}</template>
        </div>
      </div>
      <div class="escrow-acts">
        <button class="btn" @click="openEscrowEdit"><Icon name="cpu" :size="16" />{{ t('settings.configure') }}</button>
        <button class="btn" @click="openRecoveryEdit"><Icon name="key" :size="16" />{{ t('settings.escrow.generateCode') }}</button>
        <button class="btn" :disabled="escrowTesting || !escrow?.clientDest" @click="testEscrowDest">
          <Icon name="activity" :size="16" />{{ escrowTesting ? t('settings.testing') : t('settings.escrow.testDestination') }}
        </button>
        <button class="btn btn-primary" :disabled="escrowBackingUp || !escrow?.enabled" @click="backupNow">
          <Icon name="database" :size="16" />{{ escrowBackingUp ? t('settings.escrow.backingUp') : t('settings.escrow.backupNow') }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="loading"><div class="spinner"></div>{{ t('settings.loadingCaps') }}</div>
    <div v-else-if="error" class="errbox">
      <Icon name="alert" :size="32" />
      <div class="errbox-title">{{ t('settings.loadFailed') }}</div>
      <div class="errbox-sub">{{ error }}</div>
      <button class="btn" @click="load"><Icon name="refresh" :size="15" />{{ t('settings.tryAgain') }}</button>
    </div>
    <div v-else-if="sources.length === 0" class="empty-files">
      <Icon name="database" :size="30" />
      <p>{{ t('settings.empty') }}</p>
      <div class="head-acts">
        <button class="btn btn-primary" @click="openNewCluster"><Icon name="plus" :size="16" />{{ t('settings.addCluster') }}</button>
        <button class="btn btn-primary" @click="openNew"><Icon name="plus" :size="16" />{{ t('settings.addConnection') }}</button>
      </div>
    </div>
    <div v-else class="conn-list">
      <div v-for="s in sources" :key="s.kind + ':' + s.data.id" class="conn-item">
        <div class="conn-ic"><Icon :name="s.kind === 'cluster' ? 'gauge' : 'database'" :size="22" /></div>
        <div class="conn-main">
          <div class="conn-name">
            {{ s.data.name }}
            <span class="conn-tag" :class="s.kind === 'cluster' ? 'tag-cluster' : 'tag-conn'">{{ s.kind === 'cluster' ? t('settings.tag.cluster') : t('settings.tag.connection') }}</span>
          </div>
          <div v-if="s.kind === 'cluster'" class="conn-sub">
            admin {{ s.data.adminEndpoint }} · s3 {{ s.data.s3Endpoint }} · {{ s.data.region }}
            · {{ s.data.adminConfigured ? t('settings.source.tokenSet') : t('settings.source.noToken') }}
          </div>
          <div v-else class="conn-sub">
            {{ s.data.endpoint }} · {{ s.data.region }} · {{ s.data.accessKey }}
            · {{ s.data.buckets.length ? t('settings.source.fixedBuckets', { count: s.data.buckets.length }) : t('settings.source.allBuckets') }}
            · {{ s.data.secretSet ? t('settings.source.secretSet') : t('settings.source.noSecret') }}
          </div>
        </div>
        <div class="conn-acts">
          <button class="iconbtn" :title="t('settings.edit')" @click="s.kind === 'cluster' ? openEditCluster(s.data) : openEdit(s.data)"><Icon name="cpu" :size="17" /></button>
          <button class="iconbtn iconbtn-danger" :title="t('settings.remove')" @click="s.kind === 'cluster' ? (clusterToDelete = s.data) : (toDelete = s.data)"><Icon name="trash" :size="17" /></button>
        </div>
      </div>
    </div>

    <!-- editor modal -->
    <Modal v-if="editing" :title="editing === 'new' ? t('settings.connections.newTitle') : t('settings.connections.editTitle')" icon="database" @close="editing = null">
      <div class="field">
        <label class="field-label">{{ t('settings.nameLabel') }}</label>
        <input class="field-input" v-model="form.name" :placeholder="t('settings.namePlaceholder')" />
      </div>
      <div class="field">
        <label class="field-label">{{ t('settings.s3EndpointLabel') }}</label>
        <input class="field-input" v-model="form.endpoint" :placeholder="t('settings.connections.endpointPlaceholder')" />
      </div>
      <div class="modal-row">
        <div class="field">
          <label class="field-label">{{ t('settings.regionLabel') }}</label>
          <input class="field-input" v-model="form.region" placeholder="garage" />
        </div>
        <div class="field">
          <label class="field-label">Access key</label>
          <input class="field-input" v-model="form.accessKey" placeholder="GK…" autocomplete="off" />
        </div>
      </div>
      <div class="field">
        <label class="field-label">Secret key</label>
        <input class="field-input" type="password" v-model="form.secretKey"
               :placeholder="secretSet ? t('settings.keepCurrentSecret') : 'secret key'" autocomplete="off" />
      </div>
      <div class="field">
        <label class="field-label">{{ t('settings.connections.bucketsLabel') }}</label>
        <input class="field-input" v-model="form.bucketsText" placeholder="prod-assets, backups" />
      </div>
      <div v-if="testResult" class="test-result" :class="testResult.ok ? 'ok' : 'err'">
        <template v-if="testResult.ok">{{ t('settings.connections.testOk', { count: testResult.buckets?.length || 0, list: testResult.buckets?.length ? ': ' + testResult.buckets.join(', ') : '' }) }}</template>
        <template v-else>✕ {{ testResult.error }}</template>
      </div>
      <template #foot>
        <button class="btn" :disabled="testing" @click="test"><Icon name="activity" :size="16" />{{ testing ? t('settings.testing') : t('settings.connections.test') }}</button>
        <span style="flex:1"></span>
        <button class="btn" @click="editing = null">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="saving" @click="save"><Icon name="check" :size="16" />{{ saving ? t('settings.saving') : t('common.save') }}</button>
      </template>
    </Modal>

    <!-- delete confirm -->
    <Modal v-if="toDelete" :title="t('settings.connections.deleteTitle')" icon="trash" @close="toDelete = null">
      <p class="modal-text" v-html="t('settings.connections.deleteText', { name: escapeHtml(toDelete.name) })"></p>
      <p class="modal-warn"><Icon name="shield" :size="14" /> {{ t('settings.connections.deleteWarn') }}</p>
      <template #foot>
        <button class="btn" @click="toDelete = null">{{ t('common.cancel') }}</button>
        <button class="btn btn-danger" @click="confirmDelete"><Icon name="trash" :size="16" />{{ t('common.remove') }}</button>
      </template>
    </Modal>

    <!-- cluster editor modal -->
    <Modal v-if="clusterEditing" :title="clusterEditing === 'new' ? t('settings.clusters.newTitle') : t('settings.clusters.editTitle')" icon="gauge" @close="clusterEditing = null">
      <div class="field">
        <label class="field-label">{{ t('settings.nameLabel') }}</label>
        <input class="field-input" v-model="clusterForm.name" :placeholder="t('settings.namePlaceholder')" />
      </div>
      <div class="field">
        <label class="field-label">{{ t('settings.s3EndpointLabel') }}</label>
        <input class="field-input" v-model="clusterForm.s3Endpoint" placeholder="http://host:3900" />
      </div>
      <div class="modal-row">
        <div class="field">
          <label class="field-label">Admin API endpoint</label>
          <input class="field-input" v-model="clusterForm.adminEndpoint" placeholder="http://host:3903" autocomplete="off" />
        </div>
        <div class="field">
          <label class="field-label">{{ t('settings.regionLabel') }}</label>
          <input class="field-input" v-model="clusterForm.region" placeholder="garage" />
        </div>
      </div>
      <div class="field">
        <label class="field-label">Admin API token</label>
        <input class="field-input" type="password" v-model="clusterForm.adminToken"
               :placeholder="clusterAdminConfigured ? t('settings.clusters.adminTokenSet') : 'admin token'" autocomplete="off" />
        <p class="modal-hint">{{ t('settings.clusters.adminTokenHint') }}</p>
      </div>
      <template #foot>
        <button class="btn" @click="clusterEditing = null">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="clusterSaving" @click="saveCluster"><Icon name="check" :size="16" />{{ clusterSaving ? t('settings.saving') : t('common.save') }}</button>
      </template>
    </Modal>

    <!-- cluster delete confirm -->
    <Modal v-if="clusterToDelete" :title="t('settings.clusters.deleteTitle')" icon="trash" @close="clusterToDelete = null">
      <p class="modal-text" v-html="t('settings.clusters.deleteText', { name: escapeHtml(clusterToDelete.name) })"></p>
      <p class="modal-warn"><Icon name="shield" :size="14" /> {{ t('settings.clusters.deleteWarn') }}</p>
      <template #foot>
        <button class="btn" @click="clusterToDelete = null">{{ t('common.cancel') }}</button>
        <button class="btn btn-danger" @click="confirmDeleteCluster"><Icon name="trash" :size="16" />{{ t('common.remove') }}</button>
      </template>
    </Modal>

    <!-- reveal/backup da KEK -->
    <Modal v-if="kekShown && kek" :title="t('settings.kek.modalTitle')" icon="lock" wide @close="closeKek">
      <p class="modal-warn">
        <Icon name="alert" :size="16" class="ic" />
        <span v-html="t('settings.kek.modalWarn')"></span>
      </p>
      <div class="modal-row">
        <div class="field">
          <label class="field-label">{{ t('settings.kek.version') }}</label>
          <input class="field-input" :value="kek.version ?? '—'" readonly />
        </div>
        <div class="field">
          <label class="field-label">{{ t('settings.kek.fingerprint') }}</label>
          <input class="field-input" :value="kek.fingerprint" readonly />
        </div>
      </div>
      <div class="field">
        <label class="field-label">{{ t('settings.kek.secretLabel') }}</label>
        <textarea class="field-input kek-secret" :value="kek.kekBase64" readonly rows="3"></textarea>
      </div>
      <template #foot>
        <button class="btn" @click="closeKek">{{ t('common.close') }}</button>
        <span style="flex:1"></span>
        <button class="btn" @click="copyKek"><Icon name="copy" :size="16" />{{ t('common.copy') }}</button>
        <button class="btn btn-primary" @click="downloadKek"><Icon name="download" :size="16" />{{ t('settings.kek.downloadKey') }}</button>
      </template>
    </Modal>

    <Modal v-if="escrowEditing" :title="t('settings.escrow.configTitle')" icon="cpu" @close="escrowEditing = false">
      <div class="field">
        <label class="field-label"><input type="checkbox" v-model="escrowForm.enabled" /> {{ t('settings.escrow.enable') }}</label>
      </div>
      <div class="field">
        <label class="field-label">{{ t('settings.escrow.endpointLabel') }}</label>
        <input class="field-input" v-model="escrowForm.endpoint" :placeholder="t('settings.escrow.endpointPlaceholder')" />
      </div>
      <div class="modal-row">
        <div class="field">
          <label class="field-label">{{ t('settings.regionLabel') }}</label>
          <input class="field-input" v-model="escrowForm.region" placeholder="garage" />
        </div>
        <div class="field">
          <label class="field-label">Access key</label>
          <input class="field-input" v-model="escrowForm.accessKey" placeholder="GK…" autocomplete="off" />
        </div>
      </div>
      <div class="field">
        <label class="field-label">Secret key</label>
        <input class="field-input" type="password" v-model="escrowForm.secretKey"
               :placeholder="escrowDestSet ? t('settings.escrow.keepSecret') : 'secret key'" autocomplete="off" />
      </div>
      <div class="modal-row">
        <div class="field">
          <label class="field-label">Bucket</label>
          <input class="field-input" v-model="escrowForm.bucket" placeholder="dr-backups" />
        </div>
        <div class="field">
          <label class="field-label">{{ t('settings.escrow.prefixLabel') }}</label>
          <input class="field-input" v-model="escrowForm.prefix" placeholder="cockpit/" />
        </div>
      </div>
      <div v-if="escrow?.vendorAvailable" class="field">
        <label class="field-label">
          <input type="checkbox" v-model="escrowForm.vendorEnabled" /> {{ t('settings.escrow.vendorEnable') }}
        </label>
        <p class="modal-hint">{{ t('settings.escrow.vendorFingerprint', { fingerprint: escrow.vendorFingerprint ?? '' }) }}</p>
      </div>
      <div v-else class="modal-hint">{{ t('settings.escrow.vendorUnavailable') }}</div>
      <template #foot>
        <button class="btn" @click="escrowEditing = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="escrowSaving" @click="saveEscrow"><Icon name="check" :size="16" />{{ escrowSaving ? t('settings.saving') : t('common.save') }}</button>
      </template>
    </Modal>

    <Modal v-if="recoveryEditing" :title="t('settings.recovery.title')" icon="key" wide @close="recoveryEditing = false">
      <template v-if="!recoveryCode">
        <p class="modal-text" v-html="t('settings.recovery.intro')"></p>
        <div class="field">
          <label class="field-label">{{ t('settings.recovery.manualLabel') }}</label>
          <input class="field-input" type="password" v-model="recoveryManual" autocomplete="off" />
        </div>
      </template>
      <template v-else>
        <p class="modal-warn">
          <Icon name="alert" :size="16" class="ic" />
          <span v-html="t('settings.recovery.warn')"></span>
        </p>
        <div class="field">
          <label class="field-label">{{ t('settings.recovery.title') }}</label>
          <textarea class="field-input kek-secret" :value="recoveryCode" readonly rows="2"></textarea>
        </div>
      </template>
      <template #foot>
        <template v-if="!recoveryCode">
          <button class="btn" @click="recoveryEditing = false">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" :disabled="recoveryGenerating" @click="genRecovery"><Icon name="key" :size="16" />{{ recoveryGenerating ? t('settings.recovery.generating') : t('settings.recovery.generate') }}</button>
        </template>
        <template v-else>
          <button class="btn" @click="copyRecoveryCode"><Icon name="copy" :size="16" />{{ t('common.copy') }}</button>
          <span style="flex:1"></span>
          <button class="btn btn-primary" :disabled="recoveryAcking" @click="ackRecovery"><Icon name="check" :size="16" />{{ recoveryAcking ? t('settings.recovery.confirming') : t('settings.recovery.stored') }}</button>
        </template>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.head-acts { display: flex; gap: 10px; flex-wrap: wrap; }
.conn-name { display: flex; align-items: center; gap: 8px; }
.conn-tag {
  font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em;
  padding: 2px 7px; border-radius: 999px; border: 1px solid currentColor; line-height: 1.4;
}
.tag-cluster { color: var(--amber, #ffb02e); }
.tag-conn { color: var(--neon, #2dd4ff); }

.kek-card {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 16px; margin-bottom: 18px;
  border: 1px solid var(--line-2, rgba(255,255,255,.1)); border-radius: 12px;
  background: var(--bg-0, rgba(255,255,255,.02));
}
.kek-ic {
  flex: none; width: 40px; height: 40px; border-radius: 10px;
  display: grid; place-items: center;
  color: var(--green, #34d399);
  background: color-mix(in srgb, var(--green, #34d399) 14%, transparent);
}
.kek-main { flex: 1; min-width: 0; }
.kek-title { font-weight: 600; margin-bottom: 3px; }
.kek-desc { font-size: 12.5px; line-height: 1.5; color: var(--text-3, #9aa4b2); }
.kek-desc code {
  font-size: 11.5px; padding: 1px 5px; border-radius: 5px;
  background: var(--line-2, rgba(255,255,255,.08));
}
.kek-secret { font-family: ui-monospace, monospace; font-size: 12.5px; word-break: break-all; resize: none; }
.escrow-card { align-items: flex-start; flex-wrap: wrap; }
.escrow-status { margin-top: 8px; font-size: 12px; color: var(--text-3, #9aa4b2); }
.escrow-acts { display: flex; gap: 8px; flex-wrap: wrap; flex: none; }
</style>
