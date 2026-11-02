<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { ref, computed, onMounted, provide, watch } from 'vue';
import type { Connection, Cluster, ClusterInput } from '../core/models';
import { api, apiErrMsg, ApiError, type ConnectionPayload, type EscrowStatus } from '../core/api';
import { useToast } from '../core/toast';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';
import LicensePanel from '../components/settings/LicensePanel.vue';
import SsoPanel from '../components/settings/SsoPanel.vue';
import AuditPanel from '../components/settings/AuditPanel.vue';
import BrandingPanel from '../components/settings/BrandingPanel.vue';
import SettingsSection from '../components/settings/SettingsSection.vue';
import { useEdition, OPEN_LICENSE_KEY } from '../core/edition';
import type { LicenseFeature } from '../core/models';
import { t, fmtDateTime } from '../i18n';

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const toast = useToast();
const { edition, has } = useEdition();

type SectionId = 'storage' | 'security' | 'sso' | 'audit' | 'branding' | 'license';
type GroupId = 'storage' | 'security' | 'access' | 'compliance' | 'appearance' | 'instance';
interface SectionDef { id: SectionId; group: GroupId; icon: string; feature?: LicenseFeature }
const SECTIONS: SectionDef[] = [
  { id: 'storage', group: 'storage', icon: 'database' },
  { id: 'security', group: 'security', icon: 'lock' },
  { id: 'sso', group: 'access', icon: 'shield', feature: 'sso' },
  { id: 'audit', group: 'compliance', icon: 'activity', feature: 'audit-export' },
  { id: 'branding', group: 'appearance', icon: 'palette', feature: 'branding' },
  { id: 'license', group: 'instance', icon: 'key' },
];
const SECTION_IDS = SECTIONS.map((s) => s.id);
const isSectionId = (value: string): value is SectionId => (SECTION_IDS as string[]).includes(value);
const sectionFromHash = (): SectionId => {
  const match = window.location.hash.match(/^#\/settings\/([\w-]+)/);
  return match && isSectionId(match[1]!) ? match[1] : 'storage';
};
const section = ref<SectionId>(sectionFromHash());
const current = computed(() => SECTIONS.find((s) => s.id === section.value)!);
watch(section, (id) => {
  try { history.replaceState(history.state, '', `#/settings/${id}`); } catch { return; }
});
function openSection(id: SectionId) {
  section.value = id;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
provide(OPEN_LICENSE_KEY, () => openSection('license'));

const EDITION_LABEL = { community: 'Community', pro: 'Pro', enterprise: 'Enterprise' } as const;

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
const readiness = computed(() => {
  const e = escrow.value;
  const checks = [
    { key: 'checkDest' as const, done: !!e?.clientDest },
    { key: 'checkCode' as const, done: !!e?.recoverySet && !!e?.recoveryShown },
    { key: 'checkAuto' as const, done: !!e?.enabled },
  ];
  return { checks, done: checks.filter((c) => c.done).length, total: checks.length };
});

function railStatus(def: SectionDef): { text: string; tone: string; lock: boolean } {
  if (def.feature && !has(def.feature)) return { text: '', tone: '', lock: true };
  if (def.id === 'storage') return { text: String(sources.value.length), tone: sources.value.length ? '' : 'is-warn', lock: false };
  if (def.id === 'security') {
    if (!escrow.value) return { text: '', tone: '', lock: false };
    const r = readiness.value;
    return { text: `${r.done}/${r.total}`, tone: r.done === r.total ? 'is-on' : 'is-warn', lock: false };
  }
  if (def.id === 'license') return { text: EDITION_LABEL[edition.value.edition], tone: edition.value.edition === 'community' ? '' : 'is-neon', lock: false };
  return { text: '', tone: '', lock: false };
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
    <div class="view-head cfg-head">
      <div>
        <div class="cfg-eyebrow">// {{ t('settingsLayout.eyebrow') }}</div>
        <h1 class="view-title">{{ t('settingsLayout.title') }}</h1>
        <p class="view-sub">{{ t('settingsLayout.subtitle') }}</p>
      </div>
      <button class="cfg-edition" :class="'is-' + edition.edition" @click="openSection('license')">
        <span class="cfg-edition-dot"></span>
        <span class="cfg-edition-name">{{ EDITION_LABEL[edition.edition] }}</span>
        <span class="cfg-edition-sub">{{ edition.edition === 'community' ? 'AGPL-3.0' : t('settings.license.title') }}</span>
      </button>
    </div>

    <div class="cfg-shell">
      <nav class="cfg-rail" :aria-label="t('settingsLayout.navLabel')">
        <template v-for="(def, i) in SECTIONS" :key="def.id">
          <div v-if="i === 0 || SECTIONS[i - 1]!.group !== def.group" class="cfg-rail-group">{{ t(`settingsLayout.groups.${def.group}`) }}</div>
          <button class="cfg-rail-item" :class="{ 'is-active': section === def.id }" :aria-current="section === def.id ? 'page' : undefined" @click="openSection(def.id)">
            <Icon :name="def.icon" :size="16" />
            <span class="cfg-rail-label">{{ t(`settingsLayout.sections.${def.id}.label`) }}</span>
            <span v-if="railStatus(def).lock" class="cfg-rail-lock"><Icon name="lock" :size="12" /></span>
            <span v-else-if="railStatus(def).text" class="cfg-rail-status" :class="railStatus(def).tone">{{ railStatus(def).text }}</span>
          </button>
        </template>
      </nav>

      <div class="cfg-content">
        <SettingsSection
          :key="section"
          :group="t(`settingsLayout.groups.${current.group}`)"
          :title="t(`settingsLayout.sections.${section}.title`)"
          :desc="t(`settingsLayout.sections.${section}.desc`)"
        >
          <template v-if="section === 'storage' && sources.length" #actions>
            <button class="btn" @click="openNewCluster"><Icon name="gauge" :size="16" />{{ t('settings.newCluster') }}</button>
            <button class="btn btn-primary" @click="openNew"><Icon name="plus" :size="16" />{{ t('settings.newConnection') }}</button>
          </template>

          <template v-if="section === 'storage'">
            <div v-if="loading" class="loading"><div class="spinner"></div>{{ t('settings.loadingCaps') }}</div>
            <div v-else-if="error" class="errbox">
              <Icon name="alert" :size="32" />
              <div class="errbox-title">{{ t('settings.loadFailed') }}</div>
              <div class="errbox-sub">{{ error }}</div>
              <button class="btn" @click="load"><Icon name="refresh" :size="15" />{{ t('settings.tryAgain') }}</button>
            </div>
            <div v-else-if="sources.length === 0" class="cfg-empty">
              <div class="cfg-empty-title">{{ t('settingsLayout.storage.emptyTitle') }}</div>
              <p class="cfg-empty-desc">{{ t('settingsLayout.storage.emptyDesc') }}</p>
              <div class="cfg-tiles">
                <button class="cfg-tile is-cluster" @click="openNewCluster">
                  <span class="cfg-tile-ic"><Icon name="gauge" :size="22" /></span>
                  <span class="cfg-tile-title">{{ t('settingsLayout.storage.clusterTileTitle') }}</span>
                  <span class="cfg-tile-desc">{{ t('settingsLayout.storage.clusterTileDesc') }}</span>
                  <span class="cfg-tile-cta"><Icon name="plus" :size="14" />{{ t('settings.addCluster') }}</span>
                </button>
                <button class="cfg-tile" @click="openNew">
                  <span class="cfg-tile-ic"><Icon name="database" :size="22" /></span>
                  <span class="cfg-tile-title">{{ t('settingsLayout.storage.connTileTitle') }}</span>
                  <span class="cfg-tile-desc">{{ t('settingsLayout.storage.connTileDesc') }}</span>
                  <span class="cfg-tile-cta"><Icon name="plus" :size="14" />{{ t('settings.addConnection') }}</span>
                </button>
              </div>
            </div>
            <div v-else class="cfg-sources">
              <article v-for="s in sources" :key="s.kind + ':' + s.data.id" class="cfg-panel cfg-source" :class="s.kind === 'cluster' ? 'is-cluster' : 'is-conn'">
                <div class="cfg-panel-head">
                  <div class="cfg-panel-title">
                    <Icon :name="s.kind === 'cluster' ? 'gauge' : 'database'" :size="17" />{{ s.data.name }}
                    <span class="cfg-chip" :class="s.kind === 'cluster' ? 'is-warn' : 'is-neon'">{{ s.kind === 'cluster' ? t('settingsLayout.storage.kindCluster') : t('settingsLayout.storage.kindConnection') }}</span>
                  </div>
                  <div class="cfg-actions">
                    <button class="iconbtn" :title="t('settings.edit')" @click="s.kind === 'cluster' ? openEditCluster(s.data) : openEdit(s.data)"><Icon name="edit" :size="16" /></button>
                    <button class="iconbtn iconbtn-danger" :title="t('settings.remove')" @click="s.kind === 'cluster' ? (clusterToDelete = s.data) : (toDelete = s.data)"><Icon name="trash" :size="16" /></button>
                  </div>
                </div>
                <div v-if="s.kind === 'cluster'" class="cfg-readouts">
                  <div class="cfg-readout">
                    <div class="cfg-readout-label">{{ t('settingsLayout.storage.endpoint') }}</div>
                    <div class="cfg-readout-value" :title="s.data.s3Endpoint">{{ s.data.s3Endpoint }}</div>
                  </div>
                  <div class="cfg-readout">
                    <div class="cfg-readout-label">{{ t('settingsLayout.storage.admin') }}</div>
                    <div class="cfg-readout-value" :title="s.data.adminEndpoint">{{ s.data.adminEndpoint }}</div>
                  </div>
                  <div class="cfg-readout">
                    <div class="cfg-readout-label">{{ t('settingsLayout.storage.region') }}</div>
                    <div class="cfg-readout-value">{{ s.data.region }}</div>
                  </div>
                  <div class="cfg-readout">
                    <div class="cfg-readout-label">{{ t('settingsLayout.storage.credentials') }}</div>
                    <div class="cfg-readout-value" :class="s.data.adminConfigured ? 'is-on' : 'is-warn'">Admin token {{ s.data.adminConfigured ? t('settingsLayout.storage.configured') : t('settingsLayout.storage.missing') }}</div>
                  </div>
                </div>
                <div v-else class="cfg-readouts">
                  <div class="cfg-readout">
                    <div class="cfg-readout-label">{{ t('settingsLayout.storage.endpoint') }}</div>
                    <div class="cfg-readout-value" :title="s.data.endpoint">{{ s.data.endpoint }}</div>
                  </div>
                  <div class="cfg-readout">
                    <div class="cfg-readout-label">{{ t('settingsLayout.storage.region') }}</div>
                    <div class="cfg-readout-value">{{ s.data.region }}</div>
                  </div>
                  <div class="cfg-readout">
                    <div class="cfg-readout-label">{{ t('settingsLayout.storage.accessKey') }}</div>
                    <div class="cfg-readout-value" :title="s.data.accessKey">{{ s.data.accessKey }}</div>
                  </div>
                  <div class="cfg-readout">
                    <div class="cfg-readout-label">{{ t('settingsLayout.storage.buckets') }}</div>
                    <div class="cfg-readout-value">{{ s.data.buckets.length ? t('settings.source.fixedBuckets', { count: s.data.buckets.length }) : t('settings.source.allBuckets') }}</div>
                  </div>
                  <div class="cfg-readout">
                    <div class="cfg-readout-label">{{ t('settingsLayout.storage.credentials') }}</div>
                    <div class="cfg-readout-value" :class="s.data.secretSet ? 'is-on' : 'is-warn'">Secret key {{ s.data.secretSet ? t('settingsLayout.storage.configured') : t('settingsLayout.storage.missing') }}</div>
                  </div>
                </div>
              </article>
            </div>
          </template>

          <template v-else-if="section === 'security'">
            <div class="cfg-panel">
              <div class="cfg-panel-head">
                <div>
                  <div class="cfg-panel-title"><Icon name="lock" :size="17" />{{ t('settingsLayout.security.kekTitle') }}</div>
                  <p class="cfg-panel-desc" v-html="t('settings.kek.desc')"></p>
                </div>
                <div class="cfg-actions">
                  <button class="btn" :disabled="kekLoading" @click="revealKek">
                    <Icon name="key" :size="16" />{{ kekLoading ? t('settings.kek.revealing') : t('settings.kek.reveal') }}
                  </button>
                </div>
              </div>
            </div>

            <div class="cfg-panel">
              <div class="cfg-panel-head">
                <div>
                  <div class="cfg-panel-title">
                    <Icon name="shield" :size="17" />{{ t('settingsLayout.security.drTitle') }}
                    <span class="cfg-chip" :class="escrow?.enabled ? 'is-on' : ''">{{ escrow?.enabled ? t('settings.escrow.on') : t('settings.escrow.off') }}</span>
                  </div>
                  <p class="cfg-panel-desc" v-html="t('settings.escrow.desc')"></p>
                </div>
                <div class="cfg-actions">
                  <button class="btn" @click="openEscrowEdit"><Icon name="cpu" :size="16" />{{ t('settings.configure') }}</button>
                </div>
              </div>

              <div v-if="escrow" class="cfg-ready">
                <div class="cfg-ready-head">
                  <span class="cfg-readout-label">{{ t('settingsLayout.security.readiness') }}</span>
                  <span class="cfg-ready-score" :class="readiness.done === readiness.total ? 'is-on' : 'is-warn'">{{ t('settingsLayout.security.readinessScore', { done: readiness.done, total: readiness.total }) }}</span>
                </div>
                <div class="cfg-ready-bar"><span v-for="c in readiness.checks" :key="c.key" :class="{ 'is-done': c.done }"></span></div>
                <ul class="cfg-ready-list">
                  <li v-for="c in readiness.checks" :key="c.key" :class="{ 'is-done': c.done }">
                    <span class="cfg-ready-mark"><Icon :name="c.done ? 'check' : 'x'" :size="12" /></span>
                    {{ t(`settingsLayout.security.${c.key}`) }}
                  </li>
                </ul>
              </div>

              <div v-if="escrow" class="cfg-readouts cfg-dr-readouts">
                <div class="cfg-readout">
                  <div class="cfg-readout-label">{{ t('settingsLayout.security.lastBackup') }}</div>
                  <div class="cfg-readout-value" :class="{ 'is-off': !escrow.lastBackupAt }">{{ fmtDate(escrow.lastBackupAt) }}{{ escrow.lastStatus ? ` · ${escrow.lastStatus}` : '' }}</div>
                </div>
                <div class="cfg-readout">
                  <div class="cfg-readout-label">{{ t('settingsLayout.security.snapshots') }}</div>
                  <div class="cfg-readout-value">{{ escrow.lastCount ?? 0 }}</div>
                </div>
                <div class="cfg-readout">
                  <div class="cfg-readout-label">{{ t('settingsLayout.security.managed') }}</div>
                  <div class="cfg-readout-value" :class="escrow.vendorEnabled ? 'is-on' : escrow.vendorAvailable ? '' : 'is-off'">
                    {{ escrow.vendorEnabled ? t('settingsLayout.security.managedOn') : escrow.vendorAvailable ? t('settingsLayout.security.managedAvailable') : t('settingsLayout.security.managedUnavailable') }}
                  </div>
                </div>
              </div>

              <div class="cfg-actions cfg-dr-actions">
                <button class="btn" @click="openRecoveryEdit"><Icon name="key" :size="16" />{{ t('settings.escrow.generateCode') }}</button>
                <button class="btn" :disabled="escrowTesting || !escrow?.clientDest" @click="testEscrowDest">
                  <Icon name="activity" :size="16" />{{ escrowTesting ? t('settings.testing') : t('settings.escrow.testDestination') }}
                </button>
                <button class="btn btn-primary" :disabled="escrowBackingUp || !escrow?.enabled" @click="backupNow">
                  <Icon name="database" :size="16" />{{ escrowBackingUp ? t('settings.escrow.backingUp') : t('settings.escrow.backupNow') }}
                </button>
              </div>
            </div>
          </template>

          <SsoPanel v-else-if="section === 'sso'" />
          <AuditPanel v-else-if="section === 'audit'" />
          <BrandingPanel v-else-if="section === 'branding'" />
          <LicensePanel v-else-if="section === 'license'" />
        </SettingsSection>
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

<style src="../components/settings/settings.css"></style>

<style scoped>
.cfg-head { align-items: flex-end; }
.cfg-eyebrow {
  margin-bottom: 8px; font-family: var(--mono); font-size: 10.5px; letter-spacing: 1.8px; text-transform: uppercase; color: var(--neon);
}
.cfg-edition {
  display: grid; grid-template-columns: auto auto; grid-template-rows: auto auto; column-gap: 10px; align-items: center;
  padding: 10px 16px; border-radius: 10px; cursor: pointer; text-align: left; font: inherit; color: var(--text);
  border: 1px solid var(--line-2); background: var(--bg-1);
  transition: border-color .15s, background .15s;
  --edition: var(--text-3);
}
.cfg-edition.is-pro { --edition: var(--neon); }
.cfg-edition.is-enterprise { --edition: var(--amber); }
.cfg-edition:hover { border-color: color-mix(in srgb, var(--edition) 55%, var(--line-2)); background: var(--bg-2); }
.cfg-edition-dot {
  grid-row: span 2; width: 9px; height: 9px; border-radius: 50%;
  background: var(--edition); box-shadow: 0 0 10px var(--edition);
}
.cfg-edition-name { font-family: var(--display-font); font-weight: 700; font-size: 14px; letter-spacing: 1.4px; text-transform: uppercase; color: var(--edition); }
.cfg-edition-sub { font-family: var(--mono); font-size: 10px; color: var(--text-3); }

.cfg-shell { display: grid; grid-template-columns: 236px minmax(0, 1fr); gap: 34px; align-items: start; }
.cfg-rail {
  position: sticky; top: 18px; display: flex; flex-direction: column; gap: 2px;
  padding: 10px; border: 1px solid var(--line); border-radius: 14px; background: var(--bg-1);
}
.cfg-rail-group {
  padding: 12px 10px 6px; font-family: var(--mono); font-size: 9.5px; letter-spacing: 1.6px; text-transform: uppercase; color: var(--text-3);
}
.cfg-rail-group:first-child { padding-top: 4px; }
.cfg-rail-item {
  position: relative; display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 9px 10px; border: 1px solid transparent; border-radius: 9px; background: none; cursor: pointer;
  font: inherit; font-size: 13.5px; color: var(--text-2); text-align: left;
  transition: background .15s, color .15s, border-color .15s;
}
.cfg-rail-item:hover { background: var(--bg-2); color: var(--text); }
.cfg-rail-item.is-active {
  color: var(--text); background: color-mix(in srgb, var(--neon) 9%, var(--bg-2));
  border-color: color-mix(in srgb, var(--neon) 28%, transparent);
}
.cfg-rail-item.is-active::before {
  content: ''; position: absolute; left: -11px; top: 9px; bottom: 9px; width: 3px; border-radius: 0 3px 3px 0;
  background: var(--neon); box-shadow: 0 0 12px var(--neon);
}
.cfg-rail-item .ic { flex: none; color: var(--text-3); }
.cfg-rail-item.is-active .ic { color: var(--neon); }
.cfg-rail-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cfg-rail-status {
  flex: none; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--line-2);
  font-family: var(--mono); font-size: 10px; color: var(--text-2);
}
.cfg-rail-status.is-on { color: var(--green); border-color: color-mix(in srgb, var(--green) 40%, transparent); }
.cfg-rail-status.is-warn { color: var(--amber); border-color: color-mix(in srgb, var(--amber) 40%, transparent); }
.cfg-rail-status.is-neon { color: var(--neon); border-color: color-mix(in srgb, var(--neon) 40%, transparent); }
.cfg-rail-lock { flex: none; display: grid; place-items: center; color: var(--amber); opacity: .85; }
.cfg-content { min-width: 0; }

.cfg-sources { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr)); gap: 16px; }
.cfg-sources .cfg-panel + .cfg-panel { margin-top: 0; }
.cfg-source { overflow: hidden; }
.cfg-source::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
  background: var(--neon); opacity: .7;
}
.cfg-source.is-cluster::before { background: var(--amber); }

.cfg-empty {
  padding: 30px; border: 1px dashed var(--line-2); border-radius: 16px; text-align: center;
  background: radial-gradient(500px 220px at 50% 0%, color-mix(in srgb, var(--neon) 7%, transparent), transparent 70%);
}
.cfg-empty-title { font-family: var(--display-font); font-weight: 700; font-size: 20px; color: var(--text); }
.cfg-empty-desc { margin: 8px auto 0; max-width: 52ch; font-size: 13.5px; color: var(--text-2); }
.cfg-tiles { margin-top: 24px; display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; text-align: left; }
.cfg-tile {
  display: flex; flex-direction: column; gap: 8px; padding: 20px; border-radius: 13px; cursor: pointer;
  font: inherit; color: var(--text); text-align: left;
  border: 1px solid var(--line-2); background: var(--bg-1);
  transition: transform .15s, border-color .15s, box-shadow .15s;
  --tile: var(--neon);
}
.cfg-tile.is-cluster { --tile: var(--amber); }
.cfg-tile:hover {
  transform: translateY(-2px); border-color: color-mix(in srgb, var(--tile) 50%, transparent);
  box-shadow: 0 10px 30px -18px var(--tile);
}
.cfg-tile-ic {
  width: 42px; height: 42px; border-radius: 10px; display: grid; place-items: center;
  color: var(--tile); background: color-mix(in srgb, var(--tile) 13%, transparent);
}
.cfg-tile-title { font-family: var(--display-font); font-weight: 700; font-size: 16px; }
.cfg-tile-desc { font-size: 13px; line-height: 1.5; color: var(--text-2); }
.cfg-tile-cta {
  margin-top: 6px; display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--mono); font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: var(--tile);
}

.cfg-ready { margin-bottom: 16px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg-0); }
.cfg-ready-head { display: flex; justify-content: space-between; align-items: center; }
.cfg-ready-score { font-family: var(--mono); font-size: 12px; }
.cfg-ready-score.is-on { color: var(--green); }
.cfg-ready-score.is-warn { color: var(--amber); }
.cfg-ready-bar { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin: 10px 0 12px; }
.cfg-ready-bar span { height: 5px; border-radius: 3px; background: var(--bg-3); }
.cfg-ready-bar span.is-done { background: var(--green); box-shadow: 0 0 8px color-mix(in srgb, var(--green) 50%, transparent); }
.cfg-ready-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.cfg-ready-list li { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text-2); }
.cfg-ready-list li.is-done { color: var(--text); }
.cfg-ready-mark {
  flex: none; width: 20px; height: 20px; border-radius: 6px; display: grid; place-items: center;
  color: var(--amber); background: color-mix(in srgb, var(--amber) 12%, transparent);
}
.cfg-ready-list li.is-done .cfg-ready-mark { color: var(--green); background: color-mix(in srgb, var(--green) 14%, transparent); }
.cfg-dr-actions { margin-top: 16px; }

.kek-secret { font-family: var(--mono); font-size: 12.5px; word-break: break-all; resize: none; }

@media (max-width: 960px) {
  .cfg-shell { grid-template-columns: 1fr; gap: 20px; }
  .cfg-rail {
    position: static; flex-direction: row; overflow-x: auto; gap: 6px; padding: 6px;
    scrollbar-width: none;
  }
  .cfg-rail::-webkit-scrollbar { display: none; }
  .cfg-rail-group { display: none; }
  .cfg-rail-item { width: auto; flex: none; }
  .cfg-rail-item.is-active::before { display: none; }
}
@media (max-width: 600px) {
  .cfg-head { flex-direction: column; align-items: flex-start; }
}
</style>
