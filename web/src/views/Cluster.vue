<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import type { Cluster, ClusterSummary, GarageBucket, GarageKey, GaragePerm, NewGarageKey } from '../core/models';
import { api, apiErrMsg, ApiError } from '../core/api';
import { useToast } from '../core/toast';
import { fmtBytes, timeAgo } from '../core/util';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';

const GB = 1024 ** 3;
const toast = useToast();
type Tab = 'dashboard' | 'buckets' | 'keys';
const tab = ref<Tab>('dashboard');

const clusters = ref<Cluster[]>([]);
const clusterId = ref('');
const loading = ref(true);            // initial clusters fetch
const tabLoading = ref(false);
const tabError = ref<string | null>(null);   // 'admin_not_configured' | message

const cluster = ref<ClusterSummary | null>(null);
const gbuckets = ref<GarageBucket[]>([]);
const gkeys = ref<GarageKey[]>([]);

const noClusters = computed(() => !loading.value && clusters.value.length === 0);

async function loadClusters() {
  loading.value = true;
  try {
    clusters.value = await api.clusters();
    if (!clusters.value.some((c) => c.id === clusterId.value)) clusterId.value = clusters.value[0]?.id ?? '';
  } catch (e) { toast.error(apiErrMsg(e)); clusters.value = []; clusterId.value = ''; }
  finally { loading.value = false; }
}
onMounted(loadClusters);
async function reload() { await loadClusters(); await loadTab(); }
defineExpose({ reload });

function onTabError(e: unknown) {
  if (e instanceof ApiError && e.status === 409) { tabError.value = 'admin_not_configured'; return; }
  const msg = apiErrMsg(e);
  tabError.value = msg;
  toast.error(msg);
}

async function loadTab() {
  if (!clusterId.value) { cluster.value = null; gbuckets.value = []; gkeys.value = []; return; }
  tabLoading.value = true; tabError.value = null;
  try {
    if (tab.value === 'dashboard') {
      const [c, b] = await Promise.all([api.cluster(clusterId.value), api.garageBuckets(clusterId.value)]);
      cluster.value = c; gbuckets.value = b;
    } else if (tab.value === 'buckets') {
      gbuckets.value = await api.garageBuckets(clusterId.value);
    } else {
      const [k, b] = await Promise.all([api.garageKeys(clusterId.value), api.garageBuckets(clusterId.value)]);
      gkeys.value = k; gbuckets.value = b;
    }
  } catch (e) { onTabError(e); }
  finally { tabLoading.value = false; }
}
watch([clusterId, tab], loadTab, { immediate: false });

// ── dashboard helpers ──
const maxBucketBytes = computed(() => Math.max(1, ...gbuckets.value.map((b) => b.bytes)));
const nodeUsed = (avail: number | null, total: number | null) =>
  (avail != null && total != null) ? total - avail : null;
const nodePct = (avail: number | null, total: number | null) =>
  (avail != null && total != null && total > 0) ? Math.round(((total - avail) / total) * 100) : null;
const bucketLabel = (b: GarageBucket) => b.aliases[0] ?? b.id.slice(0, 12);

async function copy(text: string, label = 'copiado') {
  try { await navigator.clipboard.writeText(text); toast.success(label); }
  catch { toast.error('Falha ao copiar'); }
}

// ── credenciais por bucket: secret sob demanda ──
// O secret nunca vem na listagem (o Garage o esconde por padrão e o servidor
// audita cada revelação), então cada linha expande e busca só quando pedido.
const openCreds = ref<string | null>(null);          // id do bucket expandido
const secrets = ref<Map<string, string>>(new Map()); // accessKeyId -> secret revelado
const loadingSecret = ref<string | null>(null);

function toggleCreds(bucketId: string) {
  openCreds.value = openCreds.value === bucketId ? null : bucketId;
}

async function revealSecret(keyId: string) {
  if (secrets.value.has(keyId)) { hideSecret(keyId); return; }
  loadingSecret.value = keyId;
  try {
    const r = await api.garageKeySecret(clusterId.value, keyId);
    secrets.value = new Map(secrets.value).set(keyId, r.secretAccessKey);
  } catch (e) {
    toast.error(apiErrMsg(e, 'obter secret'));
  } finally {
    loadingSecret.value = null;
  }
}

function hideSecret(keyId: string) {
  const next = new Map(secrets.value);
  next.delete(keyId);
  secrets.value = next;
}

async function copySecret(keyId: string) {
  const known = secrets.value.get(keyId);
  if (known) { await copy(known, 'secret copiado'); return; }
  loadingSecret.value = keyId;
  try {
    const r = await api.garageKeySecret(clusterId.value, keyId);
    await copy(r.secretAccessKey, 'secret copiado');
  } catch (e) {
    toast.error(apiErrMsg(e, 'obter secret'));
  } finally {
    loadingSecret.value = null;
  }
}

const permTag = (p: GaragePerm) =>
  [p.read && 'R', p.write && 'W', p.owner && 'O'].filter(Boolean).join('') || '—';

// ── buckets: create / delete / quota ──
const showNewBucket = ref(false);
const newAlias = ref('');
function openNewBucket() { newAlias.value = ''; showNewBucket.value = true; }
async function createBucket() {
  const alias = newAlias.value.trim();
  if (!alias) { toast.error('Informe o alias do bucket.'); return; }
  showNewBucket.value = false;
  try { await api.createGarageBucket(clusterId.value, alias); toast.success(`Bucket "${alias}" criado`); await loadTab(); }
  catch (e) { toast.error(apiErrMsg(e, 'criar')); }
}

const delBucket = ref<GarageBucket | null>(null);
async function confirmDeleteBucket() {
  const b = delBucket.value; if (!b) return;
  delBucket.value = null;
  try { await api.deleteGarageBucket(clusterId.value, b.id); toast.success('Bucket removido'); await loadTab(); }
  catch (e) {
    const status = e instanceof ApiError ? e.status : -1;
    toast.error(status === 502 ? 'Falha ao remover: o bucket precisa estar vazio.' : apiErrMsg(e, 'remover'));
  }
}

const editQuota = ref<GarageBucket | null>(null);
const qSizeGb = ref('');
const qObjects = ref('');
function openQuota(b: GarageBucket) {
  editQuota.value = b;
  qSizeGb.value = b.quotas.maxSize != null ? String(+(b.quotas.maxSize / GB).toFixed(2)) : '';
  qObjects.value = b.quotas.maxObjects != null ? String(b.quotas.maxObjects) : '';
}
async function saveQuota() {
  const b = editQuota.value; if (!b) return;
  const size = qSizeGb.value.trim();
  const objs = qObjects.value.trim();
  const maxSize = size ? Math.round(parseFloat(size) * GB) : null;
  const maxObjects = objs ? parseInt(objs, 10) : null;
  if ((size && !Number.isFinite(maxSize as number)) || (objs && !Number.isFinite(maxObjects as number))) {
    toast.error('Valores de quota inválidos.'); return;
  }
  editQuota.value = null;
  try { await api.setGarageQuotas(clusterId.value, b.id, maxSize, maxObjects); toast.success('Quota atualizada'); await loadTab(); }
  catch (e) { toast.error(apiErrMsg(e, 'salvar quota')); }
}

// ── keys: create / delete / per-bucket permissions ──
const showNewKey = ref(false);
const newKeyName = ref('');
const createdKey = ref<NewGarageKey | null>(null);
function openNewKey() { newKeyName.value = ''; showNewKey.value = true; }
async function createKey() {
  const name = newKeyName.value.trim();
  if (!name) { toast.error('Informe o nome da chave.'); return; }
  showNewKey.value = false;
  try {
    createdKey.value = await api.createGarageKey(clusterId.value, name);
    await loadTab();
  } catch (e) { toast.error(apiErrMsg(e, 'criar chave')); }
}

const delKey = ref<GarageKey | null>(null);
async function confirmDeleteKey() {
  const k = delKey.value; if (!k) return;
  delKey.value = null;
  try { await api.deleteGarageKey(clusterId.value, k.id); toast.success('Chave removida'); await loadTab(); }
  catch (e) { toast.error(apiErrMsg(e, 'remover chave')); }
}

const editKey = ref<GarageKey | null>(null);
function openKeyPerms(k: GarageKey) { editKey.value = k; }
function permFor(k: GarageKey, bucketId: string): GaragePerm {
  return k.buckets.find((b) => b.id === bucketId)?.permissions ?? { read: false, write: false, owner: false };
}
async function reloadKeysKeepEditor() {
  gkeys.value = await api.garageKeys(clusterId.value);
  if (editKey.value) editKey.value = gkeys.value.find((k) => k.id === editKey.value!.id) ?? null;
}
async function togglePerm(bucketId: string, flag: keyof GaragePerm) {
  const k = editKey.value; if (!k) return;
  const cur = permFor(k, bucketId);
  const next: GaragePerm = { ...cur, [flag]: !cur[flag] };
  try { await api.setGarageKeyPerm(clusterId.value, k.id, bucketId, next); await reloadKeysKeepEditor(); }
  catch (e) { toast.error(apiErrMsg(e, 'alterar permissão')); }
}
</script>

<template>
  <div class="view">
    <div class="view-head">
      <div>
        <h1 class="view-title">Cluster</h1>
        <p class="view-sub">Admin API do Garage · dashboard, buckets e chaves nativas.</p>
      </div>
      <div v-if="!noClusters" class="head-conn">
        <select class="modal-input conn-select" v-model="clusterId">
          <option v-for="c in clusters" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <button v-if="tab === 'buckets'" class="btn btn-primary" @click="openNewBucket"><Icon name="plus" :size="16" />Novo bucket</button>
        <button v-else-if="tab === 'keys'" class="btn btn-primary" @click="openNewKey"><Icon name="plus" :size="16" />Nova chave</button>
      </div>
    </div>

    <div v-if="loading" class="loading"><div class="spinner"></div>CARREGANDO…</div>

    <!-- no cluster configured -->
    <div v-else-if="noClusters" class="errbox">
      <Icon name="cpu" :size="32" />
      <div class="errbox-title">Nenhum cluster configurado</div>
      <div class="errbox-sub">Adicione um cluster Garage (endpoint Admin API + token + endpoint S3) em Configurações para ver dashboard, buckets e chaves nativas.</div>
    </div>

    <template v-else>
      <div class="tabs">
        <button class="tab" :class="{ 'tab-on': tab === 'dashboard' }" @click="tab = 'dashboard'"><Icon name="gauge" :size="15" /> Dashboard</button>
        <button class="tab" :class="{ 'tab-on': tab === 'buckets' }" @click="tab = 'buckets'"><Icon name="database" :size="15" /> Buckets</button>
        <button class="tab" :class="{ 'tab-on': tab === 'keys' }" @click="tab = 'keys'"><Icon name="key" :size="15" /> Access Keys</button>
      </div>

      <div v-if="tabLoading" class="loading"><div class="spinner"></div>CARREGANDO…</div>

      <div v-else-if="tabError === 'admin_not_configured'" class="errbox">
        <Icon name="cpu" :size="32" />
        <div class="errbox-title">Admin API não configurada</div>
        <div class="errbox-sub">Esta conexão não tem endpoint/token da Admin API. Defina-os em Configurações.</div>
      </div>

      <div v-else-if="tabError" class="errbox">
        <Icon name="alert" :size="32" />
        <div class="errbox-title">Não foi possível falar com o Garage</div>
        <div class="errbox-sub">{{ tabError }}</div>
        <button class="btn" @click="loadTab"><Icon name="refresh" :size="15" />Tentar de novo</button>
      </div>

      <!-- DASHBOARD -->
      <template v-else-if="tab === 'dashboard' && cluster">
        <div class="stat-grid">
          <div class="stat">
            <span class="stat-label"><Icon name="shield" :size="13" /> STATUS</span>
            <span class="badge" :class="cluster.status === 'healthy' ? 'badge-ok' : 'badge-warn'">{{ cluster.status }}</span>
          </div>
          <div class="stat">
            <span class="stat-label"><Icon name="database" :size="13" /> ARMAZENADO</span>
            <span class="stat-val">{{ fmtBytes(cluster.bytes) }}<em>{{ fmtBytes(cluster.dataAvail) }} livre</em></span>
          </div>
          <div class="stat">
            <span class="stat-label"><Icon name="file" :size="13" /> OBJETOS</span>
            <span class="stat-val">{{ cluster.objects.toLocaleString('pt-BR') }}</span>
          </div>
          <div class="stat">
            <span class="stat-label"><Icon name="database" :size="13" /> BUCKETS</span>
            <span class="stat-val">{{ cluster.buckets }}</span>
          </div>
          <div class="stat">
            <span class="stat-label"><Icon name="cpu" :size="13" /> NÓS</span>
            <span class="stat-val">{{ cluster.storageNodesUp }}/{{ cluster.storageNodes }}<em>{{ cluster.connectedNodes }}/{{ cluster.knownNodes }} conectados</em></span>
          </div>
          <div class="stat">
            <span class="stat-label"><Icon name="grid" :size="13" /> PARTIÇÕES OK</span>
            <span class="stat-val">{{ cluster.partitions.ok }}<em>/ {{ cluster.partitions.total }}</em></span>
          </div>
        </div>

        <h3 class="section-title">Nós do cluster</h3>
        <div class="card tbl-card">
          <table class="tbl">
            <thead>
              <tr><th>Host</th><th>Zona</th><th>Versão</th><th>Status</th><th class="num">Disco</th></tr>
            </thead>
            <tbody>
              <tr v-for="n in cluster.nodes" :key="n.id">
                <td><span class="node-dot" :class="{ off: !n.isUp }"></span>{{ n.hostname }}</td>
                <td class="muted">{{ n.zone }}</td>
                <td class="muted">{{ n.garageVersion }}</td>
                <td>{{ n.isUp ? 'online' : 'offline' }}</td>
                <td class="num">
                  <template v-if="nodePct(n.dataAvail, n.dataTotal) != null">
                    {{ fmtBytes(nodeUsed(n.dataAvail, n.dataTotal) ?? undefined) }} / {{ fmtBytes(n.dataTotal ?? undefined) }}
                    <span class="muted">({{ nodePct(n.dataAvail, n.dataTotal) }}%)</span>
                  </template>
                  <span v-else class="muted">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 class="section-title">Uso por bucket</h3>
        <div class="card">
          <p v-if="!gbuckets.length" class="muted">Nenhum bucket.</p>
          <div v-for="b in gbuckets" :key="b.id" class="use-row">
            <span class="use-name">{{ bucketLabel(b) }}</span>
            <div class="bar"><span class="bar-fill" :style="{ width: (b.bytes / maxBucketBytes * 100) + '%' }"></span></div>
            <span class="use-val">{{ fmtBytes(b.bytes) }}</span>
          </div>
        </div>
      </template>

      <!-- BUCKETS -->
      <template v-else-if="tab === 'buckets'">
        <p v-if="!gbuckets.length" class="empty">Nenhum bucket nativo nesta conexão.</p>
        <div v-else class="card tbl-card">
          <table class="tbl">
            <thead>
              <tr><th>Alias</th><th class="num">Objetos</th><th class="num">Tamanho</th><th>Quota</th><th>Chaves</th><th></th></tr>
            </thead>
            <tbody>
              <template v-for="b in gbuckets" :key="b.id">
                <tr>
                  <td>
                    <span class="node-dot" style="background:var(--neon)"></span>{{ bucketLabel(b) }}
                    <span v-if="b.aliases.length > 1" class="muted">+{{ b.aliases.length - 1 }}</span>
                  </td>
                  <td class="num">{{ b.objects.toLocaleString('pt-BR') }}</td>
                  <td class="num">{{ fmtBytes(b.bytes) }}</td>
                  <td class="muted">
                    {{ b.quotas.maxSize != null ? fmtBytes(b.quotas.maxSize) : '—' }}
                    · {{ b.quotas.maxObjects != null ? b.quotas.maxObjects.toLocaleString('pt-BR') + ' obj' : '—' }}
                  </td>
                  <td>
                    <button
                      v-if="b.keys.length" class="btn-inline"
                      :title="openCreds === b.id ? 'Ocultar credenciais' : 'Ver credenciais de acesso'"
                      @click="toggleCreds(b.id)"
                    >
                      <Icon name="key" :size="13" />
                      {{ b.keys.length }}
                      <Icon :name="openCreds === b.id ? 'chevD' : 'chevR'" :size="13" />
                    </button>
                    <span v-else class="muted">nenhuma</span>
                  </td>
                  <td class="num">
                    <div class="row-acts">
                      <button class="iconbtn" title="Quota" @click="openQuota(b)"><Icon name="gauge" :size="16" /></button>
                      <button class="iconbtn iconbtn-danger" title="Excluir" @click="delBucket = b"><Icon name="trash" :size="16" /></button>
                    </div>
                  </td>
                </tr>

                <tr v-if="openCreds === b.id" class="creds-row">
                  <td colspan="6">
                    <div v-for="k in b.keys" :key="k.accessKeyId" class="cred">
                      <div class="cred-head">
                        <Icon name="key" :size="13" />
                        <span class="cred-name">{{ k.name || '(sem nome)' }}</span>
                        <span class="perm-tags">{{ permTag(k.permissions) }}</span>
                      </div>

                      <div class="cred-line">
                        <span class="cred-label">access key</span>
                        <span class="mono cred-val copyable" @click="copy(k.accessKeyId, 'access key copiada')">
                          {{ k.accessKeyId }}<Icon name="copy" :size="12" />
                        </span>
                      </div>

                      <div class="cred-line">
                        <span class="cred-label">secret</span>
                        <span v-if="secrets.has(k.accessKeyId)" class="mono cred-val cred-secret">
                          {{ secrets.get(k.accessKeyId) }}
                        </span>
                        <span v-else class="mono cred-val muted">••••••••••••••••••••••••</span>
                        <button
                          class="btn-inline" :disabled="loadingSecret === k.accessKeyId"
                          :title="secrets.has(k.accessKeyId) ? 'Ocultar' : 'Revelar (fica na auditoria)'"
                          @click="revealSecret(k.accessKeyId)"
                        >
                          <Icon name="eye" :size="13" />{{ secrets.has(k.accessKeyId) ? 'ocultar' : 'revelar' }}
                        </button>
                        <button
                          class="btn-inline" :disabled="loadingSecret === k.accessKeyId"
                          title="Copiar secret" @click="copySecret(k.accessKeyId)"
                        >
                          <Icon name="copy" :size="13" />copiar
                        </button>
                      </div>
                    </div>
                    <div class="cred-note">
                      <Icon name="shield" :size="12" />
                      O secret é credencial de longa duração: cada revelação fica registrada na Atividade.
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ACCESS KEYS -->
      <template v-else-if="tab === 'keys'">
        <p v-if="!gkeys.length" class="empty">Nenhuma chave de acesso nesta conexão.</p>
        <div v-else class="card" v-for="k in gkeys" :key="k.id" style="margin-bottom:10px">
          <div class="kmrow-top">
            <div class="kmrow-name"><Icon name="key" :size="15" /> {{ k.name || '(sem nome)' }}
              <span v-if="k.expired" class="role-badge role-inactive" style="margin-left:8px">EXPIRADA</span>
            </div>
            <div class="row-acts">
              <button class="btn" @click="openKeyPerms(k)"><Icon name="shield" :size="15" /> Permissões</button>
              <button class="iconbtn iconbtn-danger" title="Excluir" @click="delKey = k"><Icon name="trash" :size="15" /></button>
            </div>
          </div>
          <div class="kmrow-id copyable" @click="copy(k.id, 'access key copiada')">
            <Icon name="copy" :size="13" /> <span class="mono">{{ k.id }}</span>
          </div>
          <div class="kmrow-meta">criada {{ timeAgo(k.created) }} · {{ k.buckets.length }} bucket(s)</div>
          <div v-if="k.buckets.length" class="chips">
            <span v-for="b in k.buckets" :key="b.id" class="chip">
              {{ b.aliases[0] ?? b.id.slice(0, 8) }}
              <span class="perm-tags">{{ [b.permissions.read && 'R', b.permissions.write && 'W', b.permissions.owner && 'O'].filter(Boolean).join('') || '—' }}</span>
            </span>
          </div>
        </div>
      </template>
    </template>

    <!-- new bucket -->
    <Modal v-if="showNewBucket" title="Novo bucket" icon="database" @close="showNewBucket = false">
      <div class="field">
        <label class="field-label">Alias global</label>
        <input class="field-input" v-model="newAlias" placeholder="meu-bucket" @keydown.enter="createBucket" />
      </div>
      <template #foot>
        <button class="btn" @click="showNewBucket = false">Cancelar</button>
        <button class="btn btn-primary" @click="createBucket"><Icon name="check" :size="16" />Criar bucket</button>
      </template>
    </Modal>

    <!-- delete bucket -->
    <Modal v-if="delBucket" title="Excluir bucket" icon="trash" @close="delBucket = null">
      <p class="modal-text">Excluir o bucket <strong>{{ bucketLabel(delBucket) }}</strong>?</p>
      <p class="modal-warn"><Icon name="shield" :size="14" /> O Garage só remove buckets vazios. Esta ação não pode ser desfeita.</p>
      <template #foot>
        <button class="btn" @click="delBucket = null">Cancelar</button>
        <button class="btn btn-danger" @click="confirmDeleteBucket"><Icon name="trash" :size="16" />Excluir</button>
      </template>
    </Modal>

    <!-- edit quota -->
    <Modal v-if="editQuota" title="Quota do bucket" icon="gauge" @close="editQuota = null">
      <p class="modal-text" style="margin-bottom:14px">{{ bucketLabel(editQuota) }}</p>
      <div class="modal-row">
        <div class="field">
          <label class="field-label">Tamanho máximo (GB)</label>
          <input class="field-input" v-model="qSizeGb" inputmode="decimal" placeholder="vazio = sem limite" />
        </div>
        <div class="field">
          <label class="field-label">Máx. de objetos</label>
          <input class="field-input" v-model="qObjects" inputmode="numeric" placeholder="vazio = sem limite" />
        </div>
      </div>
      <p class="modal-hint">Deixe vazio para remover o limite.</p>
      <template #foot>
        <button class="btn" @click="editQuota = null">Cancelar</button>
        <button class="btn btn-primary" @click="saveQuota"><Icon name="check" :size="16" />Salvar</button>
      </template>
    </Modal>

    <!-- new key -->
    <Modal v-if="showNewKey" title="Nova chave de acesso" icon="key" @close="showNewKey = false">
      <div class="field">
        <label class="field-label">Nome</label>
        <input class="field-input" v-model="newKeyName" placeholder="ex: app-backups" autocomplete="off" @keydown.enter="createKey" />
      </div>
      <p class="modal-hint">O secret só aparece uma vez, logo após a criação.</p>
      <template #foot>
        <button class="btn" @click="showNewKey = false">Cancelar</button>
        <button class="btn btn-primary" @click="createKey"><Icon name="check" :size="16" />Criar chave</button>
      </template>
    </Modal>

    <!-- show secret once -->
    <Modal v-if="createdKey" title="Chave criada" icon="key" @close="createdKey = null">
      <p class="modal-warn"><Icon name="shield" :size="14" /> Copie o secret agora — ele não será exibido novamente.</p>
      <div class="field" style="margin-top:14px">
        <label class="field-label">Access key ID</label>
        <div class="secret-row">
          <code class="secret">{{ createdKey.accessKeyId }}</code>
          <button class="iconbtn" title="Copiar" @click="copy(createdKey.accessKeyId, 'access key copiada')"><Icon name="copy" :size="16" /></button>
        </div>
      </div>
      <div class="field">
        <label class="field-label">Secret access key</label>
        <div class="secret-row">
          <code class="secret">{{ createdKey.secretAccessKey }}</code>
          <button class="iconbtn" title="Copiar" @click="copy(createdKey.secretAccessKey, 'secret copiado')"><Icon name="copy" :size="16" /></button>
        </div>
      </div>
      <template #foot>
        <button class="btn btn-primary" @click="createdKey = null"><Icon name="check" :size="16" />Já copiei</button>
      </template>
    </Modal>

    <!-- delete key -->
    <Modal v-if="delKey" title="Excluir chave" icon="trash" @close="delKey = null">
      <p class="modal-text">Excluir a chave <strong>{{ delKey.name || delKey.id }}</strong>?</p>
      <p class="modal-warn"><Icon name="shield" :size="14" /> Aplicações que usam este secret perdem o acesso imediatamente.</p>
      <template #foot>
        <button class="btn" @click="delKey = null">Cancelar</button>
        <button class="btn btn-danger" @click="confirmDeleteKey"><Icon name="trash" :size="16" />Excluir</button>
      </template>
    </Modal>

    <!-- key permissions editor -->
    <Modal v-if="editKey" :title="`Permissões — ${editKey.name || editKey.id}`" icon="shield" @close="editKey = null">
      <p v-if="!gbuckets.length" class="muted">Nenhum bucket disponível.</p>
      <div v-else class="perm-list">
        <div v-for="b in gbuckets" :key="b.id" class="perm-row">
          <span class="perm-bucket">{{ bucketLabel(b) }}</span>
          <div class="toggles">
            <button class="toggle" :class="{ on: permFor(editKey, b.id).read }" @click="togglePerm(b.id, 'read')">read</button>
            <button class="toggle" :class="{ on: permFor(editKey, b.id).write }" @click="togglePerm(b.id, 'write')">write</button>
            <button class="toggle" :class="{ on: permFor(editKey, b.id).owner }" @click="togglePerm(b.id, 'owner')">owner</button>
          </div>
        </div>
      </div>
      <template #foot>
        <button class="btn btn-primary" @click="editKey = null"><Icon name="check" :size="16" />Fechar</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.head-conn { display: flex; align-items: center; gap: 10px; }
.conn-select { width: auto; min-width: 180px; height: 40px; }

.tabs { display: inline-flex; gap: 2px; padding: 3px; margin-bottom: 18px; background: var(--bg-0); border: 1px solid var(--line-2); border-radius: 10px; }
.tab { display: inline-flex; align-items: center; gap: 7px; padding: 8px 16px; border: none; background: transparent; color: var(--text-3); border-radius: 7px; cursor: pointer; font-family: var(--display-font); font-weight: 600; font-size: 13px; letter-spacing: .3px; transition: color .14s, background .14s; }
.tab:hover { color: var(--text); }
.tab-on { background: var(--bg-3); color: var(--neon); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--neon) 28%, transparent); }

.card { background: var(--bg-1); border: 1px solid var(--line-2); border-radius: 14px; padding: 16px 18px; }
.tbl-card { padding: 4px 4px; overflow: hidden; }
.muted { color: var(--text-3); font-family: var(--mono); font-size: 12px; }
.mono { font-family: var(--mono); }
.row-acts { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }
.row-acts .iconbtn { width: 30px; height: 30px; }

.section-title { font-family: var(--display-font); font-weight: 700; font-size: 14px; color: var(--text); margin: 22px 0 10px; }

.stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.stat { display: flex; flex-direction: column; gap: 10px; background: var(--bg-1); border: 1px solid var(--line-2); border-radius: 14px; padding: 15px 17px; }
.stat-label { display: inline-flex; align-items: center; gap: 7px; font-family: var(--mono); font-size: 10px; letter-spacing: 1.4px; color: var(--text-3); text-transform: uppercase; }
.stat-label .ic { color: var(--neon); }
.stat-val { font-family: var(--display-font); font-weight: 700; font-size: 24px; color: var(--text); line-height: 1; }
.stat-val em { display: block; margin-top: 6px; font-family: var(--mono); font-size: 11px; font-style: normal; font-weight: 400; color: var(--text-3); }

.badge { align-self: flex-start; padding: 5px 12px; border-radius: 7px; font-family: var(--mono); font-size: 12px; font-weight: 600; letter-spacing: .5px; border: 1px solid; }
.badge-ok { color: var(--green); border-color: color-mix(in srgb, var(--green) 40%, transparent); background: color-mix(in srgb, var(--green) 12%, transparent); }
.badge-warn { color: var(--amber); border-color: color-mix(in srgb, var(--amber) 40%, transparent); background: color-mix(in srgb, var(--amber) 12%, transparent); }

.tbl { width: 100%; border-collapse: collapse; }
.tbl th { text-align: left; font-family: var(--mono); font-size: 10px; letter-spacing: 1px; color: var(--text-3); text-transform: uppercase; padding: 12px 14px; border-bottom: 1px solid var(--line); font-weight: 600; }
.tbl td { padding: 12px 14px; font-size: 13px; color: var(--text); border-bottom: 1px solid var(--line); vertical-align: middle; }
.tbl tbody tr:last-child td { border-bottom: none; }
.tbl .num { text-align: right; }
.node-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--green); margin-right: 8px; vertical-align: middle; }
.node-dot.off { background: var(--danger); }

.use-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-top: 1px solid var(--line); }
.use-row:first-child { border-top: none; }
.use-name { flex: 0 0 160px; font-size: 13px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.use-val { flex: 0 0 90px; text-align: right; font-family: var(--mono); font-size: 12px; color: var(--text-2); }
.bar { flex: 1; height: 8px; border-radius: 6px; background: var(--bg-3); overflow: hidden; }
.bar-fill { display: block; height: 100%; border-radius: 6px; background: var(--neon); }

.copyable { cursor: pointer; transition: color .14s; }
.copyable:hover { color: var(--neon); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.chip { display: inline-flex; align-items: center; gap: 7px; background: var(--bg-2); border: 1px solid var(--line-2); border-radius: 999px; padding: 4px 11px; font-size: 12px; color: var(--text-2); }
.perm-tags { font-family: var(--mono); font-size: 10px; color: var(--neon); letter-spacing: 1px; }

/* ── credenciais por bucket ── */
.btn-inline {
  display: inline-flex; align-items: center; gap: 5px;
  height: 24px; padding: 0 8px; border-radius: 6px;
  border: 1px solid var(--line-2); background: var(--bg-2); color: var(--text-2);
  font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.5px; cursor: pointer;
}
.btn-inline:hover:not(:disabled) { color: var(--neon); border-color: color-mix(in srgb, var(--neon) 40%, transparent); }
.btn-inline:disabled { opacity: 0.5; cursor: default; }

.creds-row > td { background: var(--bg-0); padding: 12px 14px; }
.cred { padding: 8px 0; }
.cred + .cred { border-top: 1px dashed var(--line); }
.cred-head { display: flex; align-items: center; gap: 7px; margin-bottom: 6px; color: var(--text); font-size: 12.5px; }
.cred-name { font-family: var(--display-font); letter-spacing: 0.3px; }
.cred-line { display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
.cred-label {
  min-width: 74px; font-family: var(--mono); font-size: 9.5px;
  letter-spacing: 1.2px; text-transform: uppercase; color: var(--text-3);
}
.cred-val { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; word-break: break-all; }
.cred-secret { color: var(--amber); }
.cred-note {
  display: flex; align-items: center; gap: 6px; margin-top: 10px;
  font-size: 11px; color: var(--text-3);
}

.secret-row { display: flex; align-items: center; gap: 8px; }
.secret { flex: 1; font-family: var(--mono); font-size: 13px; color: var(--text); background: var(--bg-0); border: 1px solid var(--line-2); border-radius: 9px; padding: 11px 13px; word-break: break-all; }

.perm-list { display: flex; flex-direction: column; gap: 6px; }
.perm-row { display: flex; align-items: center; gap: 12px; padding: 9px 0; border-top: 1px solid var(--line); }
.perm-row:first-child { border-top: none; }
.perm-bucket { flex: 1; font-size: 13px; color: var(--text); }
.toggles { display: flex; gap: 6px; }
.toggle { padding: 5px 12px; border-radius: 7px; border: 1px solid var(--line-2); background: var(--bg-2); color: var(--text-3); font-family: var(--mono); font-size: 11px; cursor: pointer; transition: color .14s, border-color .14s, background .14s; }
.toggle:hover { color: var(--text); }
.toggle.on { color: var(--neon); border-color: color-mix(in srgb, var(--neon) 45%, transparent); background: color-mix(in srgb, var(--neon) 14%, var(--bg-2)); }
</style>
