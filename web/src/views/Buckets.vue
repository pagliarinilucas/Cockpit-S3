<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { Bucket, Cluster, Connection } from '../core/models';
import { api, apiErrMsg, ApiError } from '../core/api';
import { useToast } from '../core/toast';
import { fmtBytes } from '../core/util';
import Icon from '../components/Icon.vue';
import Gauge from '../components/Gauge.vue';
import LevelBar from '../components/LevelBar.vue';
import PermBadge from '../components/PermBadge.vue';
import Modal from '../components/Modal.vue';

const props = defineProps<{ query: string; isAdmin?: boolean }>();
const emit = defineEmits<{ open: [bucket: Bucket]; goSettings: []; loaded: [buckets: Bucket[]] }>();
const toast = useToast();

const buckets = ref<Bucket[]>([]);
const cluster = ref<Cluster | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const notConfigured = ref(false);
const showNew = ref(false);
const conns = ref<Connection[]>([]);
const newName = ref('');
const newConn = ref('');

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
  const [bk, cl] = await Promise.allSettled([api.buckets(), api.cluster()]);
  if (bk.status === 'fulfilled') buckets.value = bk.value ?? [];
  else if (bk.reason instanceof ApiError && bk.reason.status === 503) notConfigured.value = true;
  else error.value = apiErrMsg(bk.reason);
  cluster.value = cl.status === 'fulfilled' ? cl.value : null;
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

const pct = (u?: number, q?: number) => (q && u != null) ? Math.round((u / q) * 100) + '%' : '—';
const objstr = (n?: number) => (n != null ? n.toLocaleString('pt-BR') : '—');
const accent = (b: Bucket) => b.color === 'green' ? 'var(--green)' : b.color === 'amber' ? 'var(--amber)' : 'var(--neon)';
const round = (n: number) => Math.round(n);
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
      <div v-if="cluster" class="cluster">
        <div class="cluster-gauge">
          <Gauge :value="cluster.usedBytes / (cluster.quotaBytes || 1)" :size="132" :stroke="11"
            :color="cluster.usedBytes / (cluster.quotaBytes || 1) > 0.85 ? 'var(--danger)' : 'var(--neon)'"
            :label="pct(cluster.usedBytes, cluster.quotaBytes)" sub="CAPACIDADE" />
        </div>
        <div class="cluster-readouts">
          <div class="readout">
            <span class="readout-label"><Icon name="database" :size="13" /> ARMAZENADO</span>
            <span class="readout-val">{{ fmtBytes(cluster.usedBytes) }}<em>/ {{ fmtBytes(cluster.quotaBytes) }}</em></span>
          </div>
          <div class="readout">
            <span class="readout-label"><Icon name="file" :size="13" /> OBJETOS</span>
            <span class="readout-val">{{ cluster.objects.toLocaleString('pt-BR') }}</span>
          </div>
          <div class="readout">
            <span class="readout-label"><Icon name="shield" :size="13" /> REPLICAÇÃO</span>
            <span class="readout-val">{{ cluster.replication }}<em>garage {{ cluster.version }}</em></span>
          </div>
        </div>
        <div class="cluster-nodes">
          <div class="nodes-title">NÓS DO CLUSTER</div>
          <div v-for="n in cluster.nodes" :key="n.id" class="node-row">
            <span class="node-dot" :class="{ off: n.status !== 'online' }"></span>
            <span class="node-id">{{ n.id }}</span>
            <span class="node-region">{{ n.region }}</span>
            <div class="node-load"><LevelBar :value="n.load" :height="4" :color="n.load > 0.7 ? 'var(--amber)' : 'var(--green)'" /></div>
            <span class="node-pct">{{ round(n.load * 100) }}%</span>
          </div>
        </div>
      </div>

      <div v-if="visible.length === 0" class="empty">{{ query ? 'Nenhum bucket corresponde à busca.' : 'Nenhum bucket disponível.' }}</div>
      <div v-else class="bgrid">
        <button v-for="b in visible" :key="b.id" class="bcard" :style="{ '--accent': accent(b) }" @click="emit('open', b)">
          <div class="bcard-top">
            <div class="bcard-icon"><Icon name="database" :size="22" /></div>
            <div v-if="b.connection" class="bcard-conn">{{ b.connection }}</div>
            <PermBadge :perm="b.perm" :small="true" />
          </div>
          <div class="bcard-name">{{ b.name ?? b.id }}</div>
          <div class="bcard-region">{{ b.region }}</div>
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
  </div>
</template>
