<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { Connection } from '../core/models';
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
const form = ref({ name: '', endpoint: '', region: 'garage', accessKey: '', secretKey: '', bucketsText: '', adminEndpoint: '', adminToken: '' });
const secretSet = ref(false);
const adminConfigured = ref(false);
const testing = ref(false);
const saving = ref(false);
const testResult = ref<{ ok: boolean; buckets?: string[]; error?: string } | null>(null);

const toDelete = ref<Connection | null>(null);

async function load() {
  loading.value = true; error.value = null;
  try { connections.value = await api.connections(); }
  catch (e) { error.value = apiErrMsg(e); }
  finally { loading.value = false; }
}
onMounted(load);
defineExpose({ reload: load });

function openNew() {
  editing.value = 'new';
  secretSet.value = false;
  adminConfigured.value = false;
  testResult.value = null;
  form.value = { name: '', endpoint: '', region: 'garage', accessKey: '', secretKey: '', bucketsText: '', adminEndpoint: '', adminToken: '' };
}
function openEdit(c: Connection) {
  editing.value = c;
  secretSet.value = c.secretSet;
  adminConfigured.value = !!c.adminConfigured;
  testResult.value = null;
  form.value = { name: c.name, endpoint: c.endpoint, region: c.region || 'garage', accessKey: c.accessKey, secretKey: '', bucketsText: c.buckets.join(', '), adminEndpoint: c.adminEndpoint || '', adminToken: '' };
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
    adminEndpoint: f.adminEndpoint.trim() || undefined,
    adminToken: f.adminToken ? f.adminToken : undefined, // omit = keep stored (on edit)
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
      <div class="field">
        <label class="field-label">Admin API endpoint (opcional)</label>
        <input class="field-input" v-model="form.adminEndpoint" placeholder="http://host:3903" autocomplete="off" />
      </div>
      <div class="field">
        <label class="field-label">Admin API token (opcional)</label>
        <input class="field-input" type="password" v-model="form.adminToken"
               :placeholder="adminConfigured ? '•••• (definido)' : ''" autocomplete="off" />
        <p class="modal-hint">Habilita a aba Cluster (dashboard/buckets/keys do Garage) para esta conexão.</p>
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
  </div>
</template>
