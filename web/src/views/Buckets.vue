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

const menu = ref<{ x: number; y: number; bucket: Bucket } | null>(null);
const renaming = ref<Bucket | null>(null);
const deleting = ref<Bucket | null>(null);

const menuItems = computed<MenuItem[]>(() => {
  const b = menu.value?.bucket;
  if (!b) return [];
  return [
    { key: 'rename', label: 'Renomear apelido', icon: 'edit' },
    { key: 'copy', label: 'Copiar nome do bucket', icon: 'copy' },
    { key: 'delete', label: 'Excluir bucket', icon: 'trash', danger: true, disabled: !canDeleteBucket(b) },
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
  if (!name || !newConn.value) { toast.error('Escolha a conexão e o nome.'); return; }
  showNew.value = false;
  try { await api.createBucket(newConn.value, name); toast.success(`Bucket "${name}" criado`); reload(); }
  catch (e) { toast.error(apiErrMsg(e, 'criar')); }
}

const objstr = (n?: number) => (n != null ? n.toLocaleString('pt-BR') : '—');
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
      .then(() => toast.success('Nome copiado'))
      .catch(() => toast.error('Não foi possível copiar'));
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
    toast.success('Apelido atualizado');
  } catch (e) { toast.error(apiErrMsg(e, 'salvar')); }
}
async function confirmDelete() {
  const b = deleting.value; deleting.value = null;
  if (!b) return;
  try {
    await api.deleteBucket(b.id);
    buckets.value = buckets.value.filter((x) => x.id !== b.id);
    toast.success('Bucket excluído');
  } catch (e) {
    const msg = e instanceof ApiError && e.status === 409
      ? 'O bucket precisa estar vazio para ser excluído.'
      : apiErrMsg(e, 'excluir');
    toast.error(msg);
  }
}
</script>

<template>
  <div class="view">
    <div class="view-head">
      <div>
        <h1 class="view-title">Buckets</h1>
        <p class="view-sub">{{ buckets.length }} buckets · cluster Garage</p>
      </div>
      <button v-if="isAdmin" class="btn btn-primary" @click="openNew"><Icon name="plus" :size="16" />Novo bucket</button>
    </div>

    <Modal v-if="showNew" title="Novo bucket" icon="database" @close="showNew = false">
      <div v-if="conns.length === 0" class="modal-hint" style="color:var(--danger)">
        Nenhuma conexão configurada — crie uma em Configurações primeiro.
      </div>
      <template v-else>
        <div class="field">
          <label class="field-label">Conexão</label>
          <select class="modal-input" v-model="newConn">
            <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div class="field">
          <label class="field-label">Nome do bucket</label>
          <input class="field-input" v-model="newName" placeholder="meu-bucket" @keydown.enter="create" />
        </div>
      </template>
      <template #foot>
        <button class="btn" @click="showNew = false">Cancelar</button>
        <button class="btn btn-primary" :disabled="conns.length === 0" @click="create"><Icon name="check" :size="16" />Criar bucket</button>
      </template>
    </Modal>

    <div v-if="loading" class="loading"><div class="spinner"></div>CARREGANDO CLUSTER…</div>

    <div v-else-if="notConfigured" class="errbox">
      <Icon name="cpu" :size="32" />
      <div class="errbox-title">Garage ainda não configurado</div>
      <div class="errbox-sub">
        {{ isAdmin
          ? 'Configure o endpoint e as credenciais do Garage para começar a ver os buckets.'
          : 'Peça a um administrador para configurar a conexão com o Garage.' }}
      </div>
      <button v-if="isAdmin" class="btn btn-primary" @click="emit('goSettings')">
        <Icon name="cpu" :size="15" />Ir para Configurações
      </button>
    </div>

    <div v-else-if="error" class="errbox">
      <Icon name="alert" :size="32" />
      <div class="errbox-title">Não foi possível carregar os buckets</div>
      <div class="errbox-sub">{{ error }}</div>
      <button class="btn" @click="reload"><Icon name="refresh" :size="15" />Tentar de novo</button>
    </div>

    <template v-else>

      <div v-if="visible.length === 0" class="empty">{{ query ? 'Nenhum bucket corresponde à busca.' : 'Nenhum bucket disponível.' }}</div>
      <div v-else class="bgrid">
        <button v-for="b in visible" :key="b.id" class="bcard" :style="{ '--accent': accent(b) }"
                @click="emit('open', b)" @contextmenu.prevent="openMenu($event, b)">
          <div class="bcard-top">
            <div class="bcard-icon"><Icon name="database" :size="22" /></div>
            <div class="bcard-conn">{{ bucketLabel(b) }}</div>
            <PermBadge :perm="b.perm" :small="true" />
          </div>
          <div class="bcard-name">{{ b.name ?? b.id }}</div>
          <div class="bcard-region">{{ b.connection ? b.connection + ' · ' : '' }}{{ b.region }}</div>
          <div class="bcard-tiles">
            <div class="bcard-tile">
              <span class="bcard-tile-val">
                <span v-if="b.statsLoading" class="bcard-skel"></span>
                <template v-else>{{ b.used != null ? fmtBytes(b.used) : '—' }}<i v-if="b.statsTruncated">+</i></template>
              </span>
              <em>armazenado</em>
            </div>
            <div class="bcard-tile">
              <span class="bcard-tile-val">
                <span v-if="b.statsLoading" class="bcard-skel"></span>
                <template v-else>{{ objstr(b.objects) }}<i v-if="b.statsTruncated">+</i></template>
              </span>
              <em>objetos</em>
            </div>
          </div>
        </button>
      </div>
    </template>

    <ContextMenu v-if="menu" :x="menu.x" :y="menu.y" :items="menuItems"
                 @select="onMenu" @close="menu = null" />

    <InputModal v-if="renaming" title="Renomear apelido" icon="edit"
                :initial="bucketLabel(renaming)" placeholder="apelido do bucket"
                hint="Deixe vazio para voltar ao nome do bucket." confirm-label="Salvar"
                @confirm="saveAlias" @close="renaming = null" />

    <Modal v-if="deleting" title="Excluir bucket" icon="trash" @close="deleting = null">
      <div class="modal-hint">
        Excluir o bucket <strong>{{ deleting.name ?? deleting.id }}</strong>? Esta ação não pode ser desfeita.
      </div>
      <template #foot>
        <button class="btn" @click="deleting = null">Cancelar</button>
        <button class="btn btn-danger" @click="confirmDelete"><Icon name="trash" :size="16" />Excluir</button>
      </template>
    </Modal>
  </div>
</template>
