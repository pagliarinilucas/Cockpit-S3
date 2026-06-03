<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { Bucket, ObjectItem, FileType } from '../core/models';
import type { UploadItem } from '../core/ui';
import { api, apiErrMsg } from '../core/api';
import { useToast } from '../core/toast';
import { fmtBytes, timeAgo, typeFromName, isPreviewable, ICON_FOR } from '../core/util';
import Icon from '../components/Icon.vue';
import PermBadge from '../components/PermBadge.vue';
import Modal from '../components/Modal.vue';
import InputModal from '../components/InputModal.vue';
import Preview from './Preview.vue';
import UploadDock from './UploadDock.vue';

const props = defineProps<{ bucket: Bucket; path: string[]; canBack?: boolean }>();
const emit = defineEmits<{ back: []; openFolder: [name: string]; crumb: [index: number] }>();
const toast = useToast();

const items = ref<ObjectItem[]>([]);
const nextToken = ref<string | null>(null);
const loadingMore = ref(false);
const loading = ref(true);
const error = ref<string | null>(null);
const viewMode = ref<'list' | 'grid'>('grid');
const query = ref('');
const selection = ref<Set<string>>(new Set());
const uploads = ref<UploadItem[]>([]);
const drag = ref(false);
const preview = ref<string | null>(null);
const showFolder = ref(false);
const toDelete = ref<{ keys: string[]; label: string } | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const canWrite = computed(() => props.bucket.perm === 'owner' || props.bucket.perm === 'read-write');
const prefix = computed(() => props.path.length ? props.path.join('/') + '/' : '');

// path is owned by App (so the browser Back button can drive it); reload whenever
// the bucket or the folder prefix changes.
watch([() => props.bucket.id, prefix], () => { selection.value = new Set(); query.value = ''; reload(); }, { immediate: true });

function mapItems(raw: ObjectItem[]): ObjectItem[] {
  return raw.map((it) => ({ ...it, type: it.kind === 'file' ? (it.type || typeFromName(it.name)) : undefined }));
}

async function reload() {
  loading.value = true; error.value = null; selection.value = new Set(); nextToken.value = null;
  try {
    const res = await api.list(props.bucket.id, prefix.value);
    items.value = mapItems(res.items ?? []);
    nextToken.value = res.nextToken ?? null;
  } catch (e) {
    error.value = apiErrMsg(e, 'listar');
    items.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadMore() {
  if (!nextToken.value || loadingMore.value) return;
  loadingMore.value = true;
  try {
    const res = await api.list(props.bucket.id, prefix.value, nextToken.value);
    items.value = [...items.value, ...mapItems(res.items ?? [])];
    nextToken.value = res.nextToken ?? null;
  } catch (e) {
    toast.error(apiErrMsg(e, 'carregar mais'));
  } finally {
    loadingMore.value = false;
  }
}

// ── search (server-side, recursive across the whole bucket under this prefix) ──
const results = ref<ObjectItem[]>([]);
const searching = ref(false);
const isSearch = computed(() => query.value.trim().length > 0);
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let searchSeq = 0;

watch(query, (q) => {
  if (searchTimer) clearTimeout(searchTimer);
  const term = q.trim();
  if (!term) { results.value = []; searching.value = false; return; }
  searching.value = true;
  searchTimer = setTimeout(() => runSearch(term), 300);
});

async function runSearch(term: string) {
  const seq = ++searchSeq;
  try {
    const res = await api.search(props.bucket.id, prefix.value, term);
    if (seq !== searchSeq) return;                 // a newer search superseded this one
    results.value = mapItems(res.items ?? []);
  } catch (e) {
    if (seq === searchSeq) { results.value = []; toast.error(apiErrMsg(e, 'buscar')); }
  } finally {
    if (seq === searchSeq) searching.value = false;
  }
}

/** Folder of a search hit, relative to the current prefix (for display). */
function relDir(it: ObjectItem): string {
  const rel = it.key.startsWith(prefix.value) ? it.key.slice(prefix.value.length) : it.key;
  const i = rel.lastIndexOf('/');
  return i >= 0 ? rel.slice(0, i + 1) : '';
}

const ordered = computed(() => {
  if (isSearch.value) return results.value;        // recursive server results (files)
  return [...items.value.filter((i) => i.kind === 'folder'), ...items.value.filter((i) => i.kind === 'file')];
});
const previewItems = computed(() => ordered.value.filter((i) => i.kind === 'file' && isPreviewable(i.type || 'file')));
const allSel = computed(() => ordered.value.length > 0 && ordered.value.every((i) => selection.value.has(i.key)));
const folderCount = computed(() => ordered.value.filter((i) => i.kind === 'folder').length);
const fileCount = computed(() => ordered.value.filter((i) => i.kind === 'file').length);
const totalSize = computed(() => ordered.value.filter((i) => i.kind === 'file').reduce((s, i) => s + (i.size || 0), 0));

// navigation
function rowClick(it: ObjectItem, e: MouseEvent) {
  if ((e.target as HTMLElement).closest('.frow-check,.frow-actions,.fcard-check,.fcard-actions')) return;
  if (it.kind === 'folder') openFolder(it);
  else if (previewable(it)) openPreview(it);
}
function openFolder(it: ObjectItem) { emit('openFolder', it.name); }
function crumb(i: number) { emit('crumb', i); }
// Plain "back" button: up one folder, or out to the bucket list when at the root.
function goUp() {
  if (props.path.length > 0) emit('crumb', props.path.length - 2);
  else if (props.canBack) emit('back');
}
const canGoUp = computed(() => props.path.length > 0 || !!props.canBack);

// selection
function toggle(it: ObjectItem) { const n = new Set(selection.value); n.has(it.key) ? n.delete(it.key) : n.add(it.key); selection.value = n; }
function selectAll() { selection.value = selection.value.size === ordered.value.length ? new Set() : new Set(ordered.value.map((i) => i.key)); }
function clearSel() { selection.value = new Set(); }

// preview
function openPreview(it: ObjectItem) { preview.value = it.key; }
const previewable = (it: ObjectItem) => it.kind === 'file' && isPreviewable(it.type || 'file');

// download / link
async function downloadItem(it: ObjectItem) {
  if (it.kind !== 'file') return;
  try {
    const url = await api.objectUrl(props.bucket.id, it.key, 'download');  // streamed via API (works over HTTPS)
    const a = document.createElement('a');
    a.href = url; a.download = it.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  } catch { toast.error('Falha ao gerar download'); }
}
async function copyLink(it: ObjectItem) {
  try {
    const { url } = await api.download(props.bucket.id, it.key);
    await navigator.clipboard.writeText(url);
    toast.info('Link assinado copiado');
  } catch { toast.error('Falha ao copiar link'); }
}
async function batchDownload() {
  const files = ordered.value.filter((i) => i.kind === 'file' && selection.value.has(i.key));
  if (!files.length) { toast.info('Selecione arquivos para baixar'); return; }
  for (const f of files) { await downloadItem(f); await new Promise((r) => setTimeout(r, 300)); }
}

// delete
function askDelete(it: ObjectItem) { toDelete.value = { keys: [it.key], label: it.name }; }
function askBatchDelete() { toDelete.value = { keys: [...selection.value], label: `${selection.value.size} itens` }; }
async function confirmDelete() {
  const d = toDelete.value; if (!d) return;
  toDelete.value = null;
  try {
    await api.deleteObjects(props.bucket.id, d.keys);
    toast.success(d.keys.length > 1 ? `${d.keys.length} itens excluídos` : `${d.label} excluído`);
    reload();
  } catch { toast.error('Falha ao excluir'); }
}

// new folder
async function createFolder(name: string) {
  if (!name.trim()) return;
  showFolder.value = false;
  try { await api.createFolder(props.bucket.id, prefix.value, name.trim()); toast.success(`Pasta "${name}" criada`); reload(); }
  catch { toast.error('Falha ao criar pasta'); }
}

// upload
function onPick(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  if (files.length) startUploads(files);
  input.value = '';
}
function startUploads(files: File[]) {
  if (!canWrite.value) { toast.error('Sem permissão de escrita neste bucket'); return; }
  for (const file of files) {
    const id = Math.random().toString(36).slice(2);
    uploads.value = [{ id, name: file.name, size: file.size, type: typeFromName(file.name), progress: 0 }, ...uploads.value];
    api.upload(props.bucket.id, prefix.value, file, (p) => {
      uploads.value = uploads.value.map((x) => x.id === id ? { ...x, progress: Math.min(0.99, p) } : x);
    }).then(() => {
      uploads.value = uploads.value.map((x) => x.id === id ? { ...x, progress: 1 } : x);
      toast.success(`${file.name} enviado`);
      reload();
    }).catch(() => {
      uploads.value = uploads.value.map((x) => x.id === id ? { ...x, error: true } : x);
      toast.error(`Falha ao enviar ${file.name}`);
    });
  }
}

// drag & drop
function onDragOver(e: DragEvent) { if (canWrite.value) { e.preventDefault(); drag.value = true; } }
function onDragLeave(e: DragEvent) { if (e.currentTarget === e.target) drag.value = false; }
function onDrop(e: DragEvent) {
  e.preventDefault(); drag.value = false;
  if (!canWrite.value) return;
  const files = Array.from(e.dataTransfer?.files || []);
  if (files.length) startUploads(files);
}

// helpers
const tp = (it: ObjectItem): FileType => it.type || typeFromName(it.name);
const iconFor = (it: ObjectItem) => ICON_FOR[tp(it)];
const iconBoxClass = (it: ObjectItem, base: string) => it.kind === 'folder' ? `${base} is-folder` : `${base} ft-${tp(it)}`;

defineExpose({ reload });
</script>

<template>
  <div class="view view-files" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
    <!-- breadcrumbs -->
    <div class="crumbs">
      <button v-if="canGoUp" class="iconbtn crumb-back" title="Voltar" @click="goUp"><Icon name="chevL" :size="18" /></button>
      <button class="crumb crumb-root" @click="canBack ? $emit('back') : $emit('crumb', -1)"><Icon name="database" :size="15" /> {{ bucket.name ?? bucket.id }}</button>
      <template v-for="(seg, i) in path" :key="i">
        <Icon name="chevR" :size="13" class="crumb-sep" />
        <button class="crumb" @click="crumb(i)">{{ seg }}</button>
      </template>
      <PermBadge :perm="bucket.perm" :small="true" />
    </div>

    <!-- toolbar -->
    <div class="ftoolbar">
      <div class="searchbox searchbox-inline">
        <Icon name="search" :size="15" />
        <input v-model="query" :placeholder="'Buscar em ' + (bucket.name ?? bucket.id) + '…'" />
        <button v-if="query" class="iconbtn" @click="query = ''"><Icon name="x" :size="14" /></button>
      </div>
      <div class="ftoolbar-right">
        <button v-if="canWrite" class="btn" @click="showFolder = true"><Icon name="folderPlus" :size="16" />Pasta</button>
        <button v-if="canWrite" class="btn btn-primary" @click="fileInput?.click()"><Icon name="upload" :size="16" />Upload</button>
        <input ref="fileInput" type="file" multiple hidden @change="onPick" />
        <div class="seg">
          <button class="seg-btn" :class="{ 'seg-on': viewMode === 'list' }" @click="viewMode = 'list'" title="Lista"><Icon name="list" :size="16" /></button>
          <button class="seg-btn" :class="{ 'seg-on': viewMode === 'grid' }" @click="viewMode = 'grid'" title="Grade"><Icon name="grid" :size="16" /></button>
        </div>
      </div>
    </div>

    <!-- selection bar -->
    <div v-if="selection.size > 0" class="selbar">
      <span class="selbar-count"><Icon name="check" :size="14" /> {{ selection.size }} selecionado{{ selection.size > 1 ? 's' : '' }}</span>
      <div class="selbar-actions">
        <button class="btn" @click="batchDownload"><Icon name="download" :size="16" />Baixar</button>
        <button v-if="canWrite" class="btn btn-danger" @click="askBatchDelete"><Icon name="trash" :size="16" />Excluir</button>
        <button class="btn" @click="clearSel"><Icon name="x" :size="16" />Limpar</button>
      </div>
    </div>

    <div v-if="loading" class="loading"><div class="spinner"></div>CARREGANDO…</div>
    <div v-else-if="error" class="errbox">
      <Icon name="alert" :size="32" />
      <div class="errbox-title">Não foi possível listar a pasta</div>
      <div class="errbox-sub">{{ error }}</div>
      <button class="btn" @click="reload"><Icon name="refresh" :size="15" />Tentar de novo</button>
    </div>
    <div v-else-if="searching && ordered.length === 0" class="loading"><div class="spinner"></div>BUSCANDO EM TODO O BUCKET…</div>
    <div v-else-if="ordered.length === 0" class="empty empty-files">
      <Icon :name="isSearch ? 'search' : 'folder'" :size="30" />
      <p>{{ isSearch ? 'Nada encontrado.' : 'Pasta vazia.' }}</p>
      <button v-if="canWrite && !isSearch" class="btn btn-primary" @click="fileInput?.click()"><Icon name="upload" :size="16" />Enviar arquivos</button>
    </div>

    <!-- list -->
    <template v-else-if="viewMode === 'list'">
      <div class="frow frow-head">
        <label class="frow-check"><input type="checkbox" :checked="allSel" @change="selectAll" /><span class="cbox"><Icon name="check" :size="12" /></span></label>
        <div class="frow-icon"></div>
        <div class="frow-name">NOME</div>
        <div class="frow-size">TAMANHO</div>
        <div class="frow-date">MODIFICADO</div>
        <div class="frow-actions"></div>
      </div>
      <div class="flist">
        <div v-for="it in ordered" :key="it.key" class="frow"
             :class="{ 'frow-sel': selection.has(it.key), 'frow-click': it.kind === 'folder' || previewable(it) }"
             @click="rowClick(it, $event)">
          <label class="frow-check" @click.stop>
            <input type="checkbox" :checked="selection.has(it.key)" @change="toggle(it)" /><span class="cbox"><Icon name="check" :size="12" /></span>
          </label>
          <div :class="iconBoxClass(it, 'frow-icon')"><Icon :name="it.kind === 'folder' ? 'folder' : iconFor(it)" :size="18" /></div>
          <div class="frow-name">
            <span class="frow-title">{{ it.name }}</span>
            <span v-if="it.kind === 'folder'" class="frow-meta">pasta</span>
            <span v-else-if="isSearch && relDir(it)" class="frow-meta"><Icon name="folder" :size="12" /> {{ relDir(it) }} · {{ tp(it) }}</span>
            <span v-else class="frow-meta">{{ tp(it) }}{{ it.by ? ' · por ' + it.by : '' }}</span>
          </div>
          <div class="frow-size">{{ it.kind === 'folder' ? '—' : fmtBytes(it.size) }}</div>
          <div class="frow-date">{{ timeAgo(it.modified) }}</div>
          <div class="frow-actions" @click.stop>
            <button v-if="previewable(it)" class="iconbtn" title="Visualizar" @click="openPreview(it)"><Icon name="eye" :size="16" /></button>
            <button v-if="it.kind === 'file'" class="iconbtn" title="Download" @click="downloadItem(it)"><Icon name="download" :size="16" /></button>
            <button class="iconbtn" title="Copiar link" @click="copyLink(it)"><Icon name="copy" :size="16" /></button>
            <button v-if="canWrite" class="iconbtn iconbtn-danger" title="Excluir" @click="askDelete(it)"><Icon name="trash" :size="16" /></button>
          </div>
        </div>
      </div>
    </template>

    <!-- grid -->
    <div v-else class="fgrid">
      <div v-for="it in ordered" :key="it.key" class="fcard"
           :class="{ 'fcard-sel': selection.has(it.key), 'fcard-folder': it.kind === 'folder' || previewable(it) }"
           @click="rowClick(it, $event)">
        <label class="fcard-check" @click.stop>
          <input type="checkbox" :checked="selection.has(it.key)" @change="toggle(it)" /><span class="cbox"><Icon name="check" :size="12" /></span>
        </label>
        <div :class="iconBoxClass(it, 'fcard-thumb')"><Icon :name="it.kind === 'folder' ? 'folder' : iconFor(it)" :size="34" /></div>
        <div class="fcard-name" :title="isSearch && relDir(it) ? relDir(it) + it.name : it.name">{{ it.name }}</div>
        <div v-if="isSearch && relDir(it)" class="fcard-meta fcard-dir" :title="relDir(it)"><Icon name="folder" :size="11" /> {{ relDir(it) }}</div>
        <div class="fcard-meta">{{ it.kind === 'folder' ? 'pasta' : fmtBytes(it.size) }}<span class="dot-sep">·</span>{{ timeAgo(it.modified) }}</div>
        <div class="fcard-actions" @click.stop>
          <button v-if="previewable(it)" class="iconbtn" title="Visualizar" @click="openPreview(it)"><Icon name="eye" :size="15" /></button>
          <button v-if="it.kind === 'file'" class="iconbtn" title="Download" @click="downloadItem(it)"><Icon name="download" :size="15" /></button>
          <button v-if="canWrite" class="iconbtn iconbtn-danger" title="Excluir" @click="askDelete(it)"><Icon name="trash" :size="15" /></button>
        </div>
      </div>
    </div>

    <!-- carregar mais (paginação) — só na navegação normal, não na busca -->
    <div v-if="!loading && !error && !isSearch && nextToken" class="loadmore">
      <button class="btn" :disabled="loadingMore" @click="loadMore">
        <Icon name="chevD" :size="16" />{{ loadingMore ? 'Carregando…' : 'Carregar mais' }}
      </button>
    </div>

    <!-- footer -->
    <div v-if="!loading && !error" class="fstatus">
      <span v-if="isSearch">{{ ordered.length }} resultado{{ ordered.length !== 1 ? 's' : '' }}{{ ordered.length >= 300 ? '+' : '' }} para “{{ query.trim() }}” · busca recursiva</span>
      <span v-else>{{ folderCount }} {{ folderCount !== 1 ? 'pastas' : 'pasta' }} · {{ fileCount }} {{ fileCount !== 1 ? 'arquivos' : 'arquivo' }}{{ nextToken ? '+' : '' }} · {{ fmtBytes(totalSize) }}{{ nextToken ? ' carregados' : ' nesta pasta' }}</span>
      <span v-if="!canWrite" class="ro-note"><Icon name="eye" :size="13" /> acesso somente leitura</span>
    </div>

    <!-- dropzone -->
    <div v-if="drag" class="dropzone">
      <div class="dropzone-inner">
        <Icon name="upload" :size="42" />
        <div class="dropzone-title">Solte para enviar</div>
        <div class="dropzone-sub">{{ bucket.name ?? bucket.id }}{{ path.length ? ' / ' + path.join(' / ') : '' }}</div>
      </div>
    </div>
  </div>

  <UploadDock :uploads="uploads" @clear="uploads = []" />

  <Preview v-if="preview" :bucket-id="bucket.id" :bucket-perm="bucket.perm" :path="prefix"
    :items="previewItems" :start-key="preview" :can-write="canWrite"
    @close="preview = null" @download="downloadItem" @copy-link="copyLink" @delete="askDelete" />

  <InputModal v-if="showFolder" title="Nova pasta" icon="folderPlus" placeholder="nome-da-pasta"
    confirmLabel="Criar pasta" @close="showFolder = false" @confirm="createFolder" />

  <Modal v-if="toDelete" title="Confirmar exclusão" icon="trash" @close="toDelete = null">
    <p class="modal-text">Excluir <strong>{{ toDelete.label }}</strong> do bucket <strong>{{ bucket.id }}</strong>?</p>
    <p class="modal-warn"><Icon name="shield" :size="14" /> Esta ação remove o objeto de todas as réplicas do cluster e não pode ser desfeita.</p>
    <template #foot>
      <button class="btn" @click="toDelete = null">Cancelar</button>
      <button class="btn btn-danger" @click="confirmDelete"><Icon name="trash" :size="16" />Excluir definitivamente</button>
    </template>
  </Modal>
</template>
