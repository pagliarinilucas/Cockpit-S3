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
      ? 'Nenhuma KEK configurada neste servidor (COCKPIT_KEK / COCKPIT_KEK_FILE).'
      : apiErrMsg(e, 'revelar a KEK');
    toast.error(msg);
  } finally { kekLoading.value = false; }
}
function closeKek() { kekShown.value = false; kek.value = null; }
function copyKek() {
  if (!kek.value) return;
  navigator.clipboard.writeText(kek.value.kekBase64)
    .then(() => toast.success('KEK copiada para a área de transferência'))
    .catch(() => toast.error('Não foi possível copiar'));
}
function downloadKek() {
  if (!kek.value) return;
  const body = [
    '# Cockpit S3 — backup da KEK (chave-mestra de criptografia em repouso)',
    '# GUARDE OFFLINE, separado do storage e do banco de dados. Sem esta chave,',
    '# os dados cifrados são IRRECUPERÁVEIS. Quem a obtiver pode decifrar tudo.',
    `# versão: ${kek.value.version ?? '—'}`,
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
  catch (e) { toast.error(apiErrMsg(e, 'carregar o status do backup de recuperação')); }
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
    toast.error('Preencha endpoint, access key, secret key e bucket do destino (ou deixe todos vazios para não alterar).');
    return;
  }
  if (f.enabled && !destFilled && !escrowDestSet.value) {
    toast.error('Configure o destino do backup antes de habilitá-lo.');
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
    toast.success('Configuração de backup salva');
    escrowEditing.value = false;
    await loadEscrow();
  } catch (e) { toast.error(apiErrMsg(e, 'salvar a configuração de backup')); }
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
    toast.error('A senha manual precisa ter pelo menos 12 caracteres.');
    return;
  }
  recoveryGenerating.value = true;
  try {
    const { code } = await api.escrowGenRecovery(manual || undefined);
    recoveryCode.value = code;
    await loadEscrow();
  } catch (e) { toast.error(apiErrMsg(e, 'gerar o código de recuperação')); }
  finally { recoveryGenerating.value = false; }
}

function copyRecoveryCode() {
  if (!recoveryCode.value) return;
  navigator.clipboard.writeText(recoveryCode.value)
    .then(() => toast.success('Código copiado para a área de transferência'))
    .catch(() => toast.error('Não foi possível copiar'));
}

async function ackRecovery() {
  recoveryAcking.value = true;
  try {
    await api.escrowAckRecovery();
    recoveryEditing.value = false;
    recoveryCode.value = null;
    await loadEscrow();
  } catch (e) { toast.error(apiErrMsg(e, 'confirmar')); }
  finally { recoveryAcking.value = false; }
}

async function testEscrowDest() {
  escrowTesting.value = true;
  try { await api.escrowTest(); toast.success('Destino acessível'); }
  catch (e) { toast.error(apiErrMsg(e, 'testar o destino')); }
  finally { escrowTesting.value = false; }
}

async function backupNow() {
  escrowBackingUp.value = true;
  try {
    const r = await api.escrowBackupNow();
    toast.success(`Backup feito (${r.key}); ${r.removed} snapshot(s) antigo(s) removido(s)`);
    await loadEscrow();
  } catch (e) { toast.error(apiErrMsg(e, 'fazer o backup')); }
  finally { escrowBackingUp.value = false; }
}

function fmtDate(ts: string | null): string {
  if (!ts) return 'nunca';
  return new Date(ts).toLocaleString();
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
  } catch (e) { testResult.value = { ok: false, error: apiErrMsg(e, 'testar') }; }
  finally { testing.value = false; }
}

async function save() {
  const f = form.value;
  if (!f.name.trim() || !f.endpoint.trim() || !f.accessKey.trim() || (!f.secretKey && !secretSet.value)) {
    toast.error('Preencha nome, endpoint, access key e secret key.');
    return;
  }
  saving.value = true;
  try {
    if (editing.value === 'new') {
      await api.createConnection(payload());
      toast.success('Conexão criada');
    } else if (editing.value) {
      await api.updateConnection(editing.value.id, payload());
      toast.success('Conexão atualizada');
    }
    editing.value = null;
    await load();
  } catch (e) { toast.error(apiErrMsg(e, 'salvar')); }
  finally { saving.value = false; }
}

async function confirmDelete() {
  const c = toDelete.value; if (!c) return;
  toDelete.value = null;
  try { await api.deleteConnection(c.id); toast.success(`Conexão "${c.name}" removida`); await load(); }
  catch (e) { toast.error(apiErrMsg(e, 'remover')); }
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
    toast.error('Preencha nome, S3 endpoint, admin endpoint e admin token.');
    return;
  }
  clusterSaving.value = true;
  try {
    if (clusterEditing.value === 'new') {
      await api.createCluster(clusterPayload());
      toast.success('Cluster criado');
    } else if (clusterEditing.value) {
      await api.updateCluster(clusterEditing.value.id, clusterPayload());
      toast.success('Cluster atualizado');
    }
    clusterEditing.value = null;
    await load();
  } catch (e) { toast.error(apiErrMsg(e, 'salvar')); }
  finally { clusterSaving.value = false; }
}

async function confirmDeleteCluster() {
  const c = clusterToDelete.value; if (!c) return;
  clusterToDelete.value = null;
  try { await api.deleteCluster(c.id); toast.success(`Cluster "${c.name}" removido`); await load(); }
  catch (e) { toast.error(apiErrMsg(e, 'remover')); }
}
</script>

<template>
  <div class="view settings">
    <div class="view-head">
      <div>
        <h1 class="view-title">Conexões & clusters</h1>
        <p class="view-sub">{{ clusters.length }} cluster(s) · {{ connections.length }} conexão(ões) S3</p>
      </div>
      <div class="head-acts">
        <button class="btn btn-primary" @click="openNewCluster"><Icon name="plus" :size="16" />Novo cluster</button>
        <button class="btn btn-primary" @click="openNew"><Icon name="plus" :size="16" />Nova conexão</button>
      </div>
    </div>

    <div class="kek-card">
      <div class="kek-ic"><Icon name="lock" :size="20" /></div>
      <div class="kek-main">
        <div class="kek-title">Chave-mestra de criptografia (KEK)</div>
        <div class="kek-desc">
          É a chave que protege todos os buckets cifrados em repouso. Ela vive só na memória
          do servidor (vinda de <code>COCKPIT_KEK</code> / <code>COCKPIT_KEK_FILE</code>).
          Faça um backup <b>offline</b> e guarde num cofre, separado do storage e do banco.
          <b>Sem ela, dados cifrados são irrecuperáveis.</b>
        </div>
      </div>
      <button class="btn" :disabled="kekLoading" @click="revealKek">
        <Icon name="key" :size="16" />{{ kekLoading ? 'Revelando…' : 'Revelar / baixar' }}
      </button>
    </div>

    <div class="kek-card escrow-card">
      <div class="kek-ic"><Icon name="shield" :size="20" /></div>
      <div class="kek-main">
        <div class="kek-title">Backup de recuperação (DR)</div>
        <div class="kek-desc">
          Backup automático cifrado da KEK + banco (não dos arquivos do storage) para um destino
          S3 à sua escolha. Precisa de um <b>código de recuperação</b> guardado offline — sem ele
          (e sem a KEK), o backup é irrecuperável.
        </div>
        <div v-if="!escrowLoading && escrow" class="escrow-status">
          último backup: {{ fmtDate(escrow.lastBackupAt) }}{{ escrow.lastStatus ? ` (${escrow.lastStatus})` : '' }}
          · {{ escrow.lastCount ?? 0 }} snapshot(s) retido(s)
          · escrow {{ escrow.enabled ? 'ligado' : 'desligado' }}
          <template v-if="escrow.vendorAvailable">
            · modo gerenciado {{ escrow.vendorEnabled ? 'ligado' : 'disponível' }} ({{ escrow.vendorFingerprint }})
          </template>
          <template v-else> · modo gerenciado não disponível nesta instalação</template>
        </div>
      </div>
      <div class="escrow-acts">
        <button class="btn" @click="openEscrowEdit"><Icon name="cpu" :size="16" />Configurar</button>
        <button class="btn" @click="openRecoveryEdit"><Icon name="key" :size="16" />Gerar código</button>
        <button class="btn" :disabled="escrowTesting || !escrow?.clientDest" @click="testEscrowDest">
          <Icon name="activity" :size="16" />{{ escrowTesting ? 'Testando…' : 'Testar destino' }}
        </button>
        <button class="btn btn-primary" :disabled="escrowBackingUp || !escrow?.enabled" @click="backupNow">
          <Icon name="database" :size="16" />{{ escrowBackingUp ? 'Fazendo backup…' : 'Fazer backup agora' }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="loading"><div class="spinner"></div>CARREGANDO…</div>
    <div v-else-if="error" class="errbox">
      <Icon name="alert" :size="32" />
      <div class="errbox-title">Não foi possível carregar</div>
      <div class="errbox-sub">{{ error }}</div>
      <button class="btn" @click="load"><Icon name="refresh" :size="15" />Tentar de novo</button>
    </div>
    <div v-else-if="sources.length === 0" class="empty-files">
      <Icon name="database" :size="30" />
      <p>Nenhuma conexão ou cluster ainda.</p>
      <div class="head-acts">
        <button class="btn btn-primary" @click="openNewCluster"><Icon name="plus" :size="16" />Adicionar cluster</button>
        <button class="btn btn-primary" @click="openNew"><Icon name="plus" :size="16" />Adicionar conexão</button>
      </div>
    </div>
    <div v-else class="conn-list">
      <div v-for="s in sources" :key="s.kind + ':' + s.data.id" class="conn-item">
        <div class="conn-ic"><Icon :name="s.kind === 'cluster' ? 'gauge' : 'database'" :size="22" /></div>
        <div class="conn-main">
          <div class="conn-name">
            {{ s.data.name }}
            <span class="conn-tag" :class="s.kind === 'cluster' ? 'tag-cluster' : 'tag-conn'">{{ s.kind === 'cluster' ? 'cluster' : 'conexão' }}</span>
          </div>
          <div v-if="s.kind === 'cluster'" class="conn-sub">
            admin {{ s.data.adminEndpoint }} · s3 {{ s.data.s3Endpoint }} · {{ s.data.region }}
            · {{ s.data.adminConfigured ? 'token ✓' : 'sem token' }}
          </div>
          <div v-else class="conn-sub">
            {{ s.data.endpoint }} · {{ s.data.region }} · {{ s.data.accessKey }}
            · {{ s.data.buckets.length ? s.data.buckets.length + ' bucket(s) fixos' : 'todos os buckets' }}
            · {{ s.data.secretSet ? 'secret ✓' : 'sem secret' }}
          </div>
        </div>
        <div class="conn-acts">
          <button class="iconbtn" title="Editar" @click="s.kind === 'cluster' ? openEditCluster(s.data) : openEdit(s.data)"><Icon name="cpu" :size="17" /></button>
          <button class="iconbtn iconbtn-danger" title="Remover" @click="s.kind === 'cluster' ? (clusterToDelete = s.data) : (toDelete = s.data)"><Icon name="trash" :size="17" /></button>
        </div>
      </div>
    </div>

    <!-- editor modal -->
    <Modal v-if="editing" :title="editing === 'new' ? 'Nova conexão' : 'Editar conexão'" icon="database" @close="editing = null">
      <div class="field">
        <label class="field-label">Nome</label>
        <input class="field-input" v-model="form.name" placeholder="ex: Garage SP" />
      </div>
      <div class="field">
        <label class="field-label">Endpoint S3</label>
        <input class="field-input" v-model="form.endpoint" placeholder="https://garage.suaempresa.internal" />
      </div>
      <div class="modal-row">
        <div class="field">
          <label class="field-label">Região</label>
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
               :placeholder="secretSet ? '•••••••• (mantém a atual se vazio)' : 'secret key'" autocomplete="off" />
      </div>
      <div class="field">
        <label class="field-label">Buckets (vírgula — vazio = listar todos)</label>
        <input class="field-input" v-model="form.bucketsText" placeholder="prod-assets, backups" />
      </div>
      <div v-if="testResult" class="test-result" :class="testResult.ok ? 'ok' : 'err'">
        <template v-if="testResult.ok">✓ Conectado. {{ testResult.buckets?.length || 0 }} bucket(s){{ testResult.buckets?.length ? ': ' + testResult.buckets.join(', ') : '' }}.</template>
        <template v-else>✕ {{ testResult.error }}</template>
      </div>
      <template #foot>
        <button class="btn" :disabled="testing" @click="test"><Icon name="activity" :size="16" />{{ testing ? 'Testando…' : 'Testar' }}</button>
        <span style="flex:1"></span>
        <button class="btn" @click="editing = null">Cancelar</button>
        <button class="btn btn-primary" :disabled="saving" @click="save"><Icon name="check" :size="16" />{{ saving ? 'Salvando…' : 'Salvar' }}</button>
      </template>
    </Modal>

    <!-- delete confirm -->
    <Modal v-if="toDelete" title="Remover conexão" icon="trash" @close="toDelete = null">
      <p class="modal-text">Remover a conexão <strong>{{ toDelete.name }}</strong>?</p>
      <p class="modal-warn"><Icon name="shield" :size="14" /> Os buckets dessa conexão deixam de aparecer. As permissões concedidas a eles ficam órfãs até reconfigurar.</p>
      <template #foot>
        <button class="btn" @click="toDelete = null">Cancelar</button>
        <button class="btn btn-danger" @click="confirmDelete"><Icon name="trash" :size="16" />Remover</button>
      </template>
    </Modal>

    <!-- cluster editor modal -->
    <Modal v-if="clusterEditing" :title="clusterEditing === 'new' ? 'Novo cluster' : 'Editar cluster'" icon="gauge" @close="clusterEditing = null">
      <div class="field">
        <label class="field-label">Nome</label>
        <input class="field-input" v-model="clusterForm.name" placeholder="ex: Garage SP" />
      </div>
      <div class="field">
        <label class="field-label">Endpoint S3</label>
        <input class="field-input" v-model="clusterForm.s3Endpoint" placeholder="http://host:3900" />
      </div>
      <div class="modal-row">
        <div class="field">
          <label class="field-label">Admin API endpoint</label>
          <input class="field-input" v-model="clusterForm.adminEndpoint" placeholder="http://host:3903" autocomplete="off" />
        </div>
        <div class="field">
          <label class="field-label">Região</label>
          <input class="field-input" v-model="clusterForm.region" placeholder="garage" />
        </div>
      </div>
      <div class="field">
        <label class="field-label">Admin API token</label>
        <input class="field-input" type="password" v-model="clusterForm.adminToken"
               :placeholder="clusterAdminConfigured ? '•••• (definido)' : 'admin token'" autocomplete="off" />
        <p class="modal-hint">Gerencia cluster, buckets e keys do Garage. Vazio mantém o token atual na edição.</p>
      </div>
      <template #foot>
        <button class="btn" @click="clusterEditing = null">Cancelar</button>
        <button class="btn btn-primary" :disabled="clusterSaving" @click="saveCluster"><Icon name="check" :size="16" />{{ clusterSaving ? 'Salvando…' : 'Salvar' }}</button>
      </template>
    </Modal>

    <!-- cluster delete confirm -->
    <Modal v-if="clusterToDelete" title="Remover cluster" icon="trash" @close="clusterToDelete = null">
      <p class="modal-text">Remover o cluster <strong>{{ clusterToDelete.name }}</strong>?</p>
      <p class="modal-warn"><Icon name="shield" :size="14" /> A key interna do cluster será removida no Garage. Os buckets desse cluster deixam de aparecer.</p>
      <template #foot>
        <button class="btn" @click="clusterToDelete = null">Cancelar</button>
        <button class="btn btn-danger" @click="confirmDeleteCluster"><Icon name="trash" :size="16" />Remover</button>
      </template>
    </Modal>

    <!-- reveal/backup da KEK -->
    <Modal v-if="kekShown && kek" title="Backup da KEK" icon="lock" wide @close="closeKek">
      <p class="modal-warn">
        <Icon name="alert" :size="16" class="ic" />
        <span>Este é o segredo que decifra <b>todos</b> os buckets cifrados. Copie/baixe e guarde num cofre offline — <b>não deixe cópia neste computador nem no storage</b>. Perder a KEK = dados irrecuperáveis; vazá-la = qualquer um pode decifrar o storage.</span>
      </p>
      <div class="modal-row">
        <div class="field">
          <label class="field-label">Versão</label>
          <input class="field-input" :value="kek.version ?? '—'" readonly />
        </div>
        <div class="field">
          <label class="field-label">Fingerprint (SHA-256)</label>
          <input class="field-input" :value="kek.fingerprint" readonly />
        </div>
      </div>
      <div class="field">
        <label class="field-label">KEK (base64, 32 bytes)</label>
        <textarea class="field-input kek-secret" :value="kek.kekBase64" readonly rows="3"></textarea>
      </div>
      <template #foot>
        <button class="btn" @click="closeKek">Fechar</button>
        <span style="flex:1"></span>
        <button class="btn" @click="copyKek"><Icon name="copy" :size="16" />Copiar</button>
        <button class="btn btn-primary" @click="downloadKek"><Icon name="download" :size="16" />Baixar .key</button>
      </template>
    </Modal>

    <Modal v-if="escrowEditing" title="Configurar backup de recuperação" icon="cpu" @close="escrowEditing = false">
      <div class="field">
        <label class="field-label"><input type="checkbox" v-model="escrowForm.enabled" /> Habilitar backup automático</label>
      </div>
      <div class="field">
        <label class="field-label">Endpoint S3 (destino)</label>
        <input class="field-input" v-model="escrowForm.endpoint" placeholder="https://s3.suaempresa.internal" />
      </div>
      <div class="modal-row">
        <div class="field">
          <label class="field-label">Região</label>
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
               :placeholder="escrowDestSet ? '•••••••• (mantém a atual se todo o destino ficar vazio)' : 'secret key'" autocomplete="off" />
      </div>
      <div class="modal-row">
        <div class="field">
          <label class="field-label">Bucket</label>
          <input class="field-input" v-model="escrowForm.bucket" placeholder="dr-backups" />
        </div>
        <div class="field">
          <label class="field-label">Prefixo (opcional)</label>
          <input class="field-input" v-model="escrowForm.prefix" placeholder="cockpit/" />
        </div>
      </div>
      <div v-if="escrow?.vendorAvailable" class="field">
        <label class="field-label">
          <input type="checkbox" v-model="escrowForm.vendorEnabled" /> Também cifrar para custódia gerenciada (vendor)
        </label>
        <p class="modal-hint">Fingerprint da chave do vendor: {{ escrow.vendorFingerprint }}</p>
      </div>
      <div v-else class="modal-hint">Modo gerenciado (vendor) não disponível nesta instalação.</div>
      <template #foot>
        <button class="btn" @click="escrowEditing = false">Cancelar</button>
        <button class="btn btn-primary" :disabled="escrowSaving" @click="saveEscrow"><Icon name="check" :size="16" />{{ escrowSaving ? 'Salvando…' : 'Salvar' }}</button>
      </template>
    </Modal>

    <Modal v-if="recoveryEditing" title="Código de recuperação" icon="key" wide @close="recoveryEditing = false">
      <template v-if="!recoveryCode">
        <p class="modal-text">
          Gera um código de recuperação usado para decifrar o backup de KEK+banco. Ele é mostrado
          <b>uma única vez</b> — depois disso não pode ser recuperado pelo sistema.
        </p>
        <div class="field">
          <label class="field-label">Senha manual (opcional, mín. 12 caracteres — deixe vazio para gerar automaticamente)</label>
          <input class="field-input" type="password" v-model="recoveryManual" autocomplete="off" />
        </div>
      </template>
      <template v-else>
        <p class="modal-warn">
          <Icon name="alert" :size="16" class="ic" />
          <span>Copie e guarde este código <b>OFFLINE, separado do storage e da KEK</b>. Sem ele + a KEK, o backup de recuperação é irrecuperável. Ele não será mostrado de novo.</span>
        </p>
        <div class="field">
          <label class="field-label">Código de recuperação</label>
          <textarea class="field-input kek-secret" :value="recoveryCode" readonly rows="2"></textarea>
        </div>
      </template>
      <template #foot>
        <template v-if="!recoveryCode">
          <button class="btn" @click="recoveryEditing = false">Cancelar</button>
          <button class="btn btn-primary" :disabled="recoveryGenerating" @click="genRecovery"><Icon name="key" :size="16" />{{ recoveryGenerating ? 'Gerando…' : 'Gerar' }}</button>
        </template>
        <template v-else>
          <button class="btn" @click="copyRecoveryCode"><Icon name="copy" :size="16" />Copiar</button>
          <span style="flex:1"></span>
          <button class="btn btn-primary" :disabled="recoveryAcking" @click="ackRecovery"><Icon name="check" :size="16" />{{ recoveryAcking ? 'Confirmando…' : 'Já guardei' }}</button>
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
