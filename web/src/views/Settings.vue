<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { Connection, Cluster, ClusterInput } from '../core/models';
import { api, apiErrMsg, type ConnectionPayload } from '../core/api';
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

// clusters (admin)
const clusters = ref<Cluster[]>([]);
const clusterEditing = ref<Cluster | 'new' | null>(null);
const clusterForm = ref({ name: '', s3Endpoint: '', adminEndpoint: '', adminToken: '', region: 'garage' });
const clusterAdminConfigured = ref(false);
const clusterSaving = ref(false);
const clusterToDelete = ref<Cluster | null>(null);

async function load() {
  loading.value = true; error.value = null;
  try {
    const [conns, cls] = await Promise.all([api.connections(), api.clusters()]);
    connections.value = conns; clusters.value = cls;
  } catch (e) { error.value = apiErrMsg(e); }
  finally { loading.value = false; }
}
onMounted(load);
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
        <h1 class="view-title">Conexões</h1>
        <p class="view-sub">{{ connections.length }} conexão(ões) S3 · Garage</p>
      </div>
      <button class="btn btn-primary" @click="openNew"><Icon name="plus" :size="16" />Nova conexão</button>
    </div>

    <div v-if="loading" class="loading"><div class="spinner"></div>CARREGANDO…</div>
    <div v-else-if="error" class="errbox">
      <Icon name="alert" :size="32" />
      <div class="errbox-title">Não foi possível carregar as conexões</div>
      <div class="errbox-sub">{{ error }}</div>
      <button class="btn" @click="load"><Icon name="refresh" :size="15" />Tentar de novo</button>
    </div>
    <div v-else-if="connections.length === 0" class="empty-files">
      <Icon name="database" :size="30" />
      <p>Nenhuma conexão ainda.</p>
      <button class="btn btn-primary" @click="openNew"><Icon name="plus" :size="16" />Adicionar conexão</button>
    </div>
    <div v-else class="conn-list">
      <div v-for="c in connections" :key="c.id" class="conn-item">
        <div class="conn-ic"><Icon name="database" :size="22" /></div>
        <div class="conn-main">
          <div class="conn-name">{{ c.name }}</div>
          <div class="conn-sub">
            {{ c.endpoint }} · {{ c.region }} · {{ c.accessKey }}
            · {{ c.buckets.length ? c.buckets.length + ' bucket(s) fixos' : 'todos os buckets' }}
            · {{ c.secretSet ? 'secret ✓' : 'sem secret' }}
          </div>
        </div>
        <div class="conn-acts">
          <button class="iconbtn" title="Editar" @click="openEdit(c)"><Icon name="cpu" :size="17" /></button>
          <button class="iconbtn iconbtn-danger" title="Remover" @click="toDelete = c"><Icon name="trash" :size="17" /></button>
        </div>
      </div>
    </div>

    <div v-if="!loading && !error" class="cluster-section">
      <div class="view-head">
        <div>
          <h1 class="view-title">Clusters</h1>
          <p class="view-sub">{{ clusters.length }} cluster(s) Garage · admin</p>
        </div>
        <button class="btn btn-primary" @click="openNewCluster"><Icon name="plus" :size="16" />Novo cluster</button>
      </div>
      <div v-if="clusters.length === 0" class="empty-files">
        <Icon name="gauge" :size="30" />
        <p>Nenhum cluster ainda.</p>
        <button class="btn btn-primary" @click="openNewCluster"><Icon name="plus" :size="16" />Adicionar cluster</button>
      </div>
      <div v-else class="conn-list">
        <div v-for="c in clusters" :key="c.id" class="conn-item">
          <div class="conn-ic"><Icon name="gauge" :size="22" /></div>
          <div class="conn-main">
            <div class="conn-name">{{ c.name }}</div>
            <div class="conn-sub">
              admin {{ c.adminEndpoint }} · s3 {{ c.s3Endpoint }} · {{ c.region }}
              · {{ c.adminConfigured ? 'token ✓' : 'sem token' }}
            </div>
          </div>
          <div class="conn-acts">
            <button class="iconbtn" title="Editar" @click="openEditCluster(c)"><Icon name="cpu" :size="17" /></button>
            <button class="iconbtn iconbtn-danger" title="Remover" @click="clusterToDelete = c"><Icon name="trash" :size="17" /></button>
          </div>
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
  </div>
</template>

<style scoped>
.cluster-section { margin-top: 36px; padding-top: 28px; border-top: 1px solid var(--line-2); }
</style>
