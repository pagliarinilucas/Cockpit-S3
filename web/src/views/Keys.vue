<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { AccessKey, Bucket, Perm } from '../core/models';
import { api, apiErrMsg, ApiError } from '../core/api';
import { useToast } from '../core/toast';
import { timeAgo } from '../core/util';
import { PERM_META, PERM_CYCLE } from '../core/perm';
import Icon from '../components/Icon.vue';
import InputModal from '../components/InputModal.vue';

const toast = useToast();
const keys = ref<AccessKey[]>([]);
const buckets = ref<Bucket[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const notImpl = ref(false);
const showNew = ref(false);

const cols = computed(() => `240px repeat(${buckets.value.length || 1}, 1fr)`);

async function reload() {
  loading.value = true; error.value = null; notImpl.value = false;
  // buckets are optional (for the matrix columns); don't let a 503 break the view
  try { buckets.value = (await api.buckets()) ?? []; } catch { buckets.value = []; }
  try {
    keys.value = (await api.keys()) ?? [];
  } catch (e) {
    if (e instanceof ApiError && e.status === 501) notImpl.value = true;
    else error.value = apiErrMsg(e);
  } finally { loading.value = false; }
}
onMounted(reload);
defineExpose({ reload });

async function cycle(k: AccessKey, bucketId: string) {
  const cur = k.grants[bucketId] ?? null;
  const next = PERM_CYCLE[(PERM_CYCLE.indexOf(cur) + 1) % PERM_CYCLE.length];
  keys.value = keys.value.map((x) => x.id === k.id ? { ...x, grants: { ...x.grants, [bucketId]: next } } : x);
  try { await api.setGrant(k.id, bucketId, next); }
  catch { toast.error('Falha ao alterar permissão'); reload(); }
}

async function create(name: string) {
  if (!name.trim()) return;
  showNew.value = false;
  try { await api.createKey(name.trim()); toast.success(`Chave "${name}" criada`); reload(); }
  catch { toast.error('Falha ao criar chave'); }
}

function copyId(id: string) {
  navigator.clipboard?.writeText(id).then(() => toast.info('ID da chave copiado'), () => toast.error('Não foi possível copiar'));
}

const cellCls = (k: AccessKey, bucketId: string) => { const p = k.grants[bucketId]; return p ? PERM_META[p].cls : 'kmcell-none'; };
const cellTitle = (k: AccessKey, b: Bucket) => `${k.name} → ${b.name ?? b.id}: ${k.grants[b.id] ?? 'sem acesso'}`;
const iconFor = (p: Perm) => PERM_META[p].icon;
</script>

<template>
  <div class="view">
    <div class="view-head">
      <div>
        <h1 class="view-title">Chaves de acesso</h1>
        <p class="view-sub">{{ keys.length }} access keys · permissões por bucket (clique para alternar)</p>
      </div>
      <button class="btn btn-primary" @click="showNew = true"><Icon name="plus" :size="16" />Nova chave</button>
    </div>

    <InputModal v-if="showNew" title="Nova chave de acesso" icon="key" placeholder="ex: deploy-staging"
      hint="A chave começa sem permissões. Conceda acesso por bucket na matriz."
      confirmLabel="Gerar chave" @close="showNew = false" @confirm="create" />

    <div v-if="loading" class="loading"><div class="spinner"></div>CARREGANDO CHAVES…</div>
    <div v-else-if="notImpl" class="empty-files">
      <Icon name="key" :size="30" />
      <p>Chaves nativas do Garage ainda não disponíveis.</p>
      <div class="errbox-sub">Requer a integração com a admin API do Garage — em breve.</div>
    </div>
    <div v-else-if="error" class="errbox">
      <Icon name="alert" :size="32" />
      <div class="errbox-title">Não foi possível carregar as chaves</div>
      <div class="errbox-sub">{{ error }}</div>
      <button class="btn" @click="reload"><Icon name="refresh" :size="15" />Tentar de novo</button>
    </div>
    <template v-else>
      <div class="keymatrix">
        <div class="kmatrix-head" :style="{ gridTemplateColumns: cols }">
          <div class="kmh-key">CHAVE</div>
          <div v-for="b in buckets" :key="b.id" class="kmh-bucket" :title="(b.connection ? b.connection + ' · ' : '') + (b.name ?? b.id)">{{ b.name ?? b.id }}</div>
        </div>
        <div v-for="k in keys" :key="k.id" class="kmrow" :style="{ gridTemplateColumns: cols }">
          <div class="kmrow-key">
            <div class="kmrow-name"><Icon name="key" :size="15" /> {{ k.name }}</div>
            <div class="kmrow-id" @click="copyId(k.id)" title="Copiar ID">
              {{ k.id.slice(0, 6) }}<span class="masked">••••••••</span>{{ k.id.slice(-4) }}
              <Icon name="copy" :size="12" />
            </div>
            <div class="kmrow-meta">usada {{ timeAgo(k.lastUsed) }} · criada {{ k.created }}</div>
          </div>
          <button v-for="b in buckets" :key="b.id" :class="'kmcell ' + cellCls(k, b.id)" @click="cycle(k, b.id)" :title="cellTitle(k, b)">
            <Icon v-if="k.grants[b.id]" :name="iconFor(k.grants[b.id]!)" :size="15" />
            <span v-else class="kmcell-dash">—</span>
          </button>
        </div>
      </div>
      <div class="keymatrix-legend">
        <span><span class="lg lg-none"></span> sem acesso</span>
        <span><span class="lg lg-ro"></span> read-only</span>
        <span><span class="lg lg-rw"></span> read/write</span>
        <span><span class="lg lg-owner"></span> owner</span>
      </div>
    </template>
  </div>
</template>
