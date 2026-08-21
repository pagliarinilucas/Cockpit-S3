<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { Bucket, ObjectItem, FileType, Perm } from '../core/models';
import type { UploadItem } from '../core/ui';
import { api, apiErrMsg } from '../core/api';
import { useToast } from '../core/toast';
import { fmtBytes, timeAgo, typeFromName, isPreviewable, ICON_FOR, bucketLabel } from '../core/util';
import { isSheetName } from '../sheet/model';
import Icon from '../components/Icon.vue';
import PermBadge from '../components/PermBadge.vue';
import Modal from '../components/Modal.vue';
import InputModal from '../components/InputModal.vue';
import Preview from './Preview.vue';
import SheetEditor from './SheetEditor.vue';
import UploadDock from './UploadDock.vue';
import ContextMenu, { type MenuItem } from '../components/ContextMenu.vue';
import Thumb from '../components/Thumb.vue';
import ShareCreate from '../components/ShareCreate.vue';
import ShareLinks from '../components/ShareLinks.vue';

const props = defineProps<{ bucket: Bucket; path: string[]; canBack?: boolean; canShare?: boolean; user?: string }>();
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
const showNewSheet = ref(false);
const editing = ref<string | null>(null);   // key da planilha aberta no editor
const renamingBucket = ref(false);
const toDelete = ref<{ keys: string[]; label: string } | null>(null);
const merge = ref<{ items: ObjectItem[]; name: string } | null>(null);
const merging = ref(false);
const zipping = ref(false);
const ctx = ref<{ x: number; y: number; item: ObjectItem } | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const folderInput = ref<HTMLInputElement | null>(null);
const shareItem = ref<ObjectItem | null>(null);   // arquivo a compartilhar (abre ShareCreate)
const showLinks = ref(false);                       // modal de gerenciamento de links

const pathPerm = ref<Perm | null>(props.bucket.perm);
const canWrite = computed(() => pathPerm.value === 'owner' || pathPerm.value === 'read-write');
// view-only vê e pré-visualiza mas não baixa; canDownload cobre read-only e acima.
const canDownload = computed(() => pathPerm.value === 'read-only' || pathPerm.value === 'read-write' || pathPerm.value === 'owner');
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
    pathPerm.value = res.perm ?? null;
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
    pathPerm.value = res.perm ?? pathPerm.value;
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
// arquivos selecionados que podem virar páginas de PDF, na ordem da lista. Inclui o tipo
// 'file' (sem extensão) porque o backend detecta o conteúdo real por magic bytes e ignora
// o que não for imagem/PDF — muitos objetos no Garage não têm extensão.
const MERGEABLE = new Set<FileType>(['image', 'pdf', 'file']);
const mergeables = computed(() => ordered.value.filter((i) => i.kind === 'file' && selection.value.has(i.key) && MERGEABLE.has(i.type || 'file')));
const selectedFiles = computed(() => ordered.value.filter((i) => i.kind === 'file' && selection.value.has(i.key)));
const onlyFilesSelected = computed(() => selection.value.size > 0 && selectedFiles.value.length === selection.value.size);
const allSel = computed(() => ordered.value.length > 0 && ordered.value.every((i) => selection.value.has(i.key)));
const folderCount = computed(() => ordered.value.filter((i) => i.kind === 'folder').length);
const fileCount = computed(() => ordered.value.filter((i) => i.kind === 'file').length);
const totalSize = computed(() => ordered.value.filter((i) => i.kind === 'file').reduce((s, i) => s + (i.size || 0), 0));

// navigation
function rowClick(it: ObjectItem, e: MouseEvent) {
  if ((e.target as HTMLElement).closest('.frow-check,.frow-actions,.fcard-check,.fcard-actions')) return;
  if (e.ctrlKey || e.metaKey) { toggle(it); return; }   // ctrl/cmd+clique alterna a seleção
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

// menu de contexto (clique direito) — ações do item apontado, espelhando os botões da linha
function onContext(it: ObjectItem, e: MouseEvent) { ctx.value = { x: e.clientX, y: e.clientY, item: it }; }
const ctxItems = computed<MenuItem[]>(() => {
  const it = ctx.value?.item; if (!it) return [];
  if (it.kind === 'folder') return [
    { key: 'open', label: 'Abrir', icon: 'folder' },
    { key: 'zip', label: 'Baixar como ZIP', icon: 'download' },
    ...(canWrite.value ? [{ key: 'delete', label: 'Excluir', icon: 'trash', danger: true } as MenuItem] : []),
  ];
  return [
    ...(previewable(it) ? [{ key: 'preview', label: 'Visualizar', icon: 'eye' } as MenuItem] : []),
    ...(editable(it) ? [{ key: 'edit', label: 'Editar planilha', icon: 'edit' } as MenuItem] : []),
    ...(canDownload.value ? [{ key: 'download', label: 'Baixar', icon: 'download' } as MenuItem] : []),
    ...(canDownload.value ? [{ key: 'copy', label: 'Copiar link', icon: 'copy' } as MenuItem] : []),
    ...(props.canShare && canDownload.value ? [{ key: 'share', label: 'Compartilhar', icon: 'share' } as MenuItem] : []),
    ...(canWrite.value ? [{ key: 'delete', label: 'Excluir', icon: 'trash', danger: true } as MenuItem] : []),
  ];
});
function onCtxSelect(key: string) {
  const it = ctx.value?.item; ctx.value = null; if (!it) return;
  if (key === 'open') openFolder(it);
  else if (key === 'zip') downloadFolderZip(it);
  else if (key === 'preview') openPreview(it);
  else if (key === 'edit') openEditor(it.key);
  else if (key === 'download') downloadItem(it);
  else if (key === 'copy') copyLink(it);
  else if (key === 'share') openShare(it);
  else if (key === 'delete') askDelete(it);
}
function openShare(it: ObjectItem) { if (it.kind === 'file') shareItem.value = it; }

// preview
function openPreview(it: ObjectItem) { preview.value = it.key; }
const previewable = (it: ObjectItem) => it.kind === 'file' && isPreviewable(it.type || 'file');

// editor de planilha
const editable = (it: ObjectItem) => it.kind === 'file' && canWrite.value && isSheetName(it.name);
function openEditor(key: string) { preview.value = null; editing.value = key; }

async function createSheet(name: string) {
  showNewSheet.value = false;
  try {
    const { key } = await api.createSheet(props.bucket.id, prefix.value, name);
    await reload();
    openEditor(key);
  } catch (e) {
    toast.error(apiErrMsg(e, 'criar planilha'));
  }
}

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
  const files = selectedFiles.value;
  if (!files.length) { toast.info('Selecione arquivos para baixar'); return; }
  for (const f of files) { await downloadItem(f); await new Promise((r) => setTimeout(r, 300)); }
}

const ZIP_ERRORS: Record<number, string> = {
  403: 'Sem permissão para baixar estes arquivos',
  413: 'Seleção muito grande para um ZIP',
  422: 'Nada para compactar aqui',
};

async function startZip(body: { prefix?: string; keys?: string[]; filename: string }) {
  if (zipping.value) return;
  zipping.value = true;
  try {
    const { ticket, count } = await api.zipTicket(props.bucket.id, { path: prefix.value, ...body });
    const a = document.createElement('a');
    a.href = api.zipUrl(props.bucket.id, ticket);
    a.download = body.filename + '.zip';
    document.body.appendChild(a); a.click(); a.remove();
    toast.info(`Compactando ${count} ite${count === 1 ? 'm' : 'ns'} — o download começa em seguida`);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 0;
    toast.error(ZIP_ERRORS[status] ?? 'Falha ao gerar o ZIP');
  } finally {
    zipping.value = false;
  }
}

function downloadFolderZip(it: ObjectItem) {
  startZip({ prefix: it.key, filename: it.name });
}

function selectionZip() {
  if (!selection.value.size) return;
  const only = selection.value.size === 1 ? ordered.value.find((i) => selection.value.has(i.key)) : null;
  const filename = only ? only.name.replace(/\.[^.]+$/, '') : (props.path[props.path.length - 1] ?? bucketLabel(props.bucket));
  startZip({ keys: [...selection.value], filename });
}

// juntar em PDF
function openMerge() { merge.value = { items: [...mergeables.value], name: 'combinado' }; }
function removeMerge(i: number) { merge.value?.items.splice(i, 1); }

// reordenação por arrastar (drag nativo): move o item em tempo real ao passar sobre outra linha
const dragIdx = ref<number | null>(null);
function onDragStart(i: number) { dragIdx.value = i; }
function onDragEnter(i: number) {
  const from = dragIdx.value, m = merge.value;
  if (from === null || from === i || !m) return;
  const arr = m.items; const [moved] = arr.splice(from, 1); arr.splice(i, 0, moved);
  dragIdx.value = i;
}
function onDragEnd() { dragIdx.value = null; }
async function confirmMerge() {
  const m = merge.value; if (!m || !m.items.length || merging.value) return;
  merging.value = true;
  try {
    const { blob, skipped } = await api.mergePdf(props.bucket.id, m.items.map((i) => i.key), m.name.trim() || 'combinado');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = (m.name.trim() || 'combinado') + '.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
    merge.value = null;
    toast.success('PDF gerado');
    if (skipped) toast.info(`${skipped} arquivo${skipped > 1 ? 's' : ''} ignorado${skipped > 1 ? 's' : ''} (formato não suportado)`);
  } catch (e) { toast.error(apiErrMsg(e, 'gerar PDF')); }
  finally { merging.value = false; }
}

// delete
function askDelete(it: ObjectItem) { toDelete.value = { keys: [it.key], label: it.name }; }
function askBatchDelete() { toDelete.value = { keys: [...selection.value], label: `${selection.value.size} itens` }; }
async function confirmDelete() {
  const d = toDelete.value; if (!d) return;
  toDelete.value = null;
  try {
    const res = await api.deleteObjects(props.bucket.id, d.keys);
    if (res.ok === false) {
      const failed = res.failed ?? [];
      toast.error(`Não foi possível excluir ${failed.length} item${failed.length > 1 ? 's' : ''}: ${failed.join(', ')}`);
    } else {
      toast.success(d.keys.length > 1 ? `${d.keys.length} itens excluídos` : `${d.label} excluído`);
    }
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
function enqueue(file: File, rel: string, onDone: () => void, onErr: () => void) {
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : '';
  const uploadPath = prefix.value + dir;
  const id = Math.random().toString(36).slice(2);
  uploads.value = [{ id, name: rel || file.name, size: file.size, type: typeFromName(file.name), progress: 0 }, ...uploads.value];
  api.upload(props.bucket.id, uploadPath, file, (p) => {
    uploads.value = uploads.value.map((x) => x.id === id ? { ...x, progress: Math.min(0.99, p) } : x);
  }, !!props.bucket.encrypted).then(() => {
    uploads.value = uploads.value.map((x) => x.id === id ? { ...x, progress: 1 } : x);
    onDone();
  }).catch(() => {
    uploads.value = uploads.value.map((x) => x.id === id ? { ...x, error: true } : x);
    onErr();
  });
}
function runBatch(items: { file: File; rel: string }[]) {
  if (!canWrite.value) { toast.error('Sem permissão de escrita neste bucket'); return; }
  if (!items.length) return;
  const total = items.length;
  const label = items[0]!.rel || items[0]!.file.name;
  let done = 0, ok = 0, fail = 0;
  const finish = () => {
    if (++done < total) return;
    if (fail === 0) toast.success(total === 1 ? `${label} enviado` : `${ok} arquivos enviados`);
    else if (ok === 0) toast.error(total === 1 ? `Falha ao enviar ${label}` : `Falha ao enviar ${fail} arquivos`);
    else toast.error(`${ok} enviados, ${fail} com falha`);
    reload();
  };
  let next = 0;
  const startNext = () => {
    if (next >= items.length) return;
    const it = items[next++]!;
    enqueue(it.file, it.rel,
      () => { ok++; finish(); startNext(); },
      () => { fail++; finish(); startNext(); });
  };
  for (let i = 0; i < Math.min(4, items.length); i++) startNext();
}
const pendingUpload = ref<{ items: { file: File; rel: string }[]; collisions: string[] } | null>(null);
function requestUpload(batch: { file: File; rel: string }[]) {
  if (!canWrite.value) { toast.error('Sem permissão de escrita neste bucket'); return; }
  if (!batch.length) return;
  const existing = new Set(items.value.filter((i) => i.kind === 'file').map((i) => i.key));
  const collisions = batch.filter((b) => existing.has(prefix.value + b.rel)).map((b) => b.rel);
  if (collisions.length) pendingUpload.value = { items: batch, collisions };
  else runBatch(batch);
}
function confirmUpload() {
  const p = pendingUpload.value; pendingUpload.value = null;
  if (p) runBatch(p.items);
}
function startUploads(files: File[]) {
  requestUpload(files.map((file) => ({ file, rel: file.webkitRelativePath || file.name })));
}

function walkEntry(entry: FileSystemEntry, base: string, out: { file: File; rel: string }[]): Promise<void> {
  return new Promise((resolve) => {
    if (entry.isFile) {
      (entry as FileSystemFileEntry).file((f) => { out.push({ file: f, rel: base + entry.name }); resolve(); }, () => resolve());
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const all: FileSystemEntry[] = [];
      const readBatch = () => reader.readEntries((batch) => {
        if (!batch.length) { Promise.all(all.map((c) => walkEntry(c, base + entry.name + '/', out))).then(() => resolve()); }
        else { all.push(...batch); readBatch(); }
      }, () => resolve());
      readBatch();
    } else resolve();
  });
}

function onDragOver(e: DragEvent) { if (canWrite.value) { e.preventDefault(); drag.value = true; } }
function onDragLeave(e: DragEvent) { if (e.currentTarget === e.target) drag.value = false; }
async function onDrop(e: DragEvent) {
  e.preventDefault(); drag.value = false;
  if (!canWrite.value) return;
  const items = Array.from(e.dataTransfer?.items ?? []);
  const entries = items
    .map((it) => it.webkitGetAsEntry?.() ?? null)
    .filter((x): x is FileSystemEntry => !!x);
  if (entries.length) {
    const collected: { file: File; rel: string }[] = [];
    await Promise.all(entries.map((en) => walkEntry(en, '', collected)));
    if (!collected.length) { toast.error('Nada para enviar'); return; }
    requestUpload(collected);
  } else {
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) startUploads(files);
  }
}

// helpers
const tp = (it: ObjectItem): FileType => it.type || typeFromName(it.name);
const iconFor = (it: ObjectItem) => ICON_FOR[tp(it)];
const iconBoxClass = (it: ObjectItem, base: string) => it.kind === 'folder' ? `${base} is-folder` : `${base} ft-${tp(it)}`;
// tenta miniatura para imagens/PDFs e arquivos sem extensão (backend fareja o conteúdo)
const thumbable = (it: ObjectItem) => it.kind === 'file' && MERGEABLE.has(tp(it));

async function saveBucketAlias(value: string) {
  renamingBucket.value = false;
  try {
    const r = await api.setBucketAlias(props.bucket.id, value);
    props.bucket.alias = r.alias ?? undefined; // mesmo objeto da lista de Buckets → reflete lá também
    toast.success('Apelido atualizado');
  } catch (e) { toast.error(apiErrMsg(e, 'salvar')); }
}

defineExpose({ reload });
</script>

<template>
  <div class="view view-files" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
    <!-- breadcrumbs -->
    <div class="crumbs">
      <button v-if="canGoUp" class="iconbtn crumb-back" title="Voltar" @click="goUp"><Icon name="chevL" :size="18" /></button>
      <button class="crumb crumb-root" @click="canBack ? $emit('back') : $emit('crumb', -1)"><Icon name="database" :size="15" /> {{ bucketLabel(bucket) }}</button>
      <button class="iconbtn" title="Renomear apelido" @click="renamingBucket = true"><Icon name="edit" :size="15" /></button>
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
        <button v-if="ordered.length > 0" class="btn" @click="selectAll" :title="allSel ? 'Desmarcar todos' : 'Selecionar todos'">
          <Icon name="check" :size="16" />{{ allSel ? 'Desmarcar' : 'Selecionar tudo' }}
        </button>
        <button v-if="canShare" class="btn" @click="showLinks = true"><Icon name="link" :size="16" />Links</button>
        <button v-if="canWrite" class="btn" @click="showFolder = true"><Icon name="folderPlus" :size="16" />Pasta</button>
        <button v-if="canWrite" class="btn" @click="folderInput?.click()"><Icon name="upload" :size="16" />Enviar pasta</button>
        <button v-if="canWrite" class="btn" @click="showNewSheet = true"><Icon name="sheet" :size="16" />Planilha</button>
        <button v-if="canWrite" class="btn btn-primary" @click="fileInput?.click()"><Icon name="upload" :size="16" />Upload</button>
        <input ref="fileInput" type="file" multiple hidden @change="onPick" />
        <input ref="folderInput" type="file" webkitdirectory multiple hidden @change="onPick" />
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
        <button v-if="canDownload && onlyFilesSelected" class="btn" @click="batchDownload"><Icon name="download" :size="16" />Baixar</button>
        <button v-if="canDownload" class="btn" :disabled="zipping" @click="selectionZip"><Icon name="download" :size="16" />{{ zipping ? 'Preparando…' : 'Baixar ZIP' }}</button>
        <button v-if="canDownload && mergeables.length >= 2" class="btn" @click="openMerge"><Icon name="pdf" :size="16" />Criar PDF</button>
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
             @click="rowClick(it, $event)" @contextmenu.prevent="onContext(it, $event)">
          <label class="frow-check" @click.stop>
            <input type="checkbox" :checked="selection.has(it.key)" @change="toggle(it)" /><span class="cbox"><Icon name="check" :size="12" /></span>
          </label>
          <div :class="iconBoxClass(it, 'frow-icon')">
            <Thumb v-if="thumbable(it)" :bucket-id="bucket.id" :obj-key="it.key" :icon="iconFor(it)" :size="18" />
            <Icon v-else :name="it.kind === 'folder' ? 'folder' : iconFor(it)" :size="18" />
          </div>
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
            <button v-if="editable(it)" class="iconbtn" title="Editar planilha" @click="openEditor(it.key)"><Icon name="edit" :size="16" /></button>
            <button v-if="canDownload && it.kind === 'file'" class="iconbtn" title="Download" @click="downloadItem(it)"><Icon name="download" :size="16" /></button>
            <button v-if="canDownload && it.kind === 'folder'" class="iconbtn" title="Baixar pasta como ZIP" :disabled="zipping" @click="downloadFolderZip(it)"><Icon name="download" :size="16" /></button>
            <button v-if="canDownload" class="iconbtn" title="Copiar link" @click="copyLink(it)"><Icon name="copy" :size="16" /></button>
            <button v-if="canShare && canDownload && it.kind === 'file'" class="iconbtn" title="Compartilhar" @click="openShare(it)"><Icon name="share" :size="16" /></button>
            <button v-if="canWrite" class="iconbtn iconbtn-danger" title="Excluir" @click="askDelete(it)"><Icon name="trash" :size="16" /></button>
          </div>
        </div>
      </div>
    </template>

    <!-- grid -->
    <div v-else class="fgrid">
      <div v-for="it in ordered" :key="it.key" class="fcard"
           :class="{ 'fcard-sel': selection.has(it.key), 'fcard-folder': it.kind === 'folder' || previewable(it) }"
           @click="rowClick(it, $event)" @contextmenu.prevent="onContext(it, $event)">
        <label class="fcard-check" @click.stop>
          <input type="checkbox" :checked="selection.has(it.key)" @change="toggle(it)" /><span class="cbox"><Icon name="check" :size="12" /></span>
        </label>
        <div :class="iconBoxClass(it, 'fcard-thumb')">
          <Thumb v-if="thumbable(it)" :bucket-id="bucket.id" :obj-key="it.key" :icon="iconFor(it)" :size="34" />
          <Icon v-else :name="it.kind === 'folder' ? 'folder' : iconFor(it)" :size="34" />
        </div>
        <div class="fcard-name" :title="isSearch && relDir(it) ? relDir(it) + it.name : it.name">{{ it.name }}</div>
        <div v-if="isSearch && relDir(it)" class="fcard-meta fcard-dir" :title="relDir(it)"><Icon name="folder" :size="11" /> {{ relDir(it) }}</div>
        <div class="fcard-meta">{{ it.kind === 'folder' ? 'pasta' : fmtBytes(it.size) }}<span class="dot-sep">·</span>{{ timeAgo(it.modified) }}</div>
        <div class="fcard-actions" @click.stop>
          <button v-if="previewable(it)" class="iconbtn" title="Visualizar" @click="openPreview(it)"><Icon name="eye" :size="15" /></button>
          <button v-if="canDownload && it.kind === 'file'" class="iconbtn" title="Download" @click="downloadItem(it)"><Icon name="download" :size="15" /></button>
          <button v-if="canDownload && it.kind === 'folder'" class="iconbtn" title="Baixar pasta como ZIP" :disabled="zipping" @click="downloadFolderZip(it)"><Icon name="download" :size="15" /></button>
          <button v-if="canShare && canDownload && it.kind === 'file'" class="iconbtn" title="Compartilhar" @click="openShare(it)"><Icon name="share" :size="15" /></button>
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
      <span v-if="!canDownload" class="ro-note"><Icon name="eye" :size="13" /> somente visualização (sem download)</span>
      <span v-else-if="!canWrite" class="ro-note"><Icon name="eye" :size="13" /> acesso somente leitura</span>
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

  <ContextMenu v-if="ctx" :x="ctx.x" :y="ctx.y" :items="ctxItems" @select="onCtxSelect" @close="ctx = null" />

  <ShareCreate v-if="shareItem" :bucket-id="bucket.id" :obj-key="shareItem.key" :filename="shareItem.name"
    @close="shareItem = null" />

  <ShareLinks v-if="showLinks" @close="showLinks = false" />

  <Preview v-if="preview" :bucket-id="bucket.id" :bucket-perm="bucket.perm" :path="prefix"
    :items="previewItems" :start-key="preview" :can-write="canWrite" :can-download="canDownload"
    @close="preview = null" @download="downloadItem" @copy-link="copyLink" @delete="askDelete"
    @edit="(it) => openEditor(it.key)" />

  <SheetEditor v-if="editing" :bucket-id="bucket.id" :object-key="editing" :user="user ?? &quot;&quot;"
    @close="editing = null; reload()" />

  <InputModal v-if="showFolder" title="Nova pasta" icon="folderPlus" placeholder="nome-da-pasta"
    confirmLabel="Criar pasta" @close="showFolder = false" @confirm="createFolder" />

  <InputModal v-if="showNewSheet" title="Nova planilha" icon="sheet" placeholder="minha-planilha"
    hint="Cria um .xlsx vazio nesta pasta e abre no editor." confirm-label="Criar planilha"
    @close="showNewSheet = false" @confirm="createSheet" />

  <InputModal v-if="renamingBucket" title="Renomear apelido" icon="edit"
              :initial="bucket.alias ?? ''" placeholder="apelido do bucket"
              hint="Deixe vazio para voltar ao nome do bucket." confirm-label="Salvar"
              @confirm="saveBucketAlias" @close="renamingBucket = false" />

  <Modal v-if="pendingUpload" title="Substituir arquivos?" icon="upload" @close="pendingUpload = null">
    <p class="modal-text">
      {{ pendingUpload.collisions.length === 1
        ? 'Já existe um arquivo com este nome nesta pasta:'
        : `Já existem ${pendingUpload.collisions.length} arquivos com o mesmo nome nesta pasta:` }}
    </p>
    <ul style="margin:8px 0 0;padding:0;list-style:none;max-height:180px;overflow:auto;font-family:var(--mono);font-size:12.5px;color:var(--text-2)">
      <li v-for="c in pendingUpload.collisions.slice(0, 10)" :key="c" style="padding:3px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ c }}</li>
      <li v-if="pendingUpload.collisions.length > 10" style="padding:3px 0;color:var(--text-3)">… e mais {{ pendingUpload.collisions.length - 10 }}</li>
    </ul>
    <p class="modal-warn"><Icon name="shield" :size="14" /> Substituir apaga o conteúdo atual — não há como desfazer.</p>
    <template #foot>
      <button class="btn" @click="pendingUpload = null">Cancelar</button>
      <button class="btn btn-danger" @click="confirmUpload"><Icon name="upload" :size="16" />Substituir</button>
    </template>
  </Modal>

  <Modal v-if="toDelete" title="Confirmar exclusão" icon="trash" @close="toDelete = null">
    <p class="modal-text">Excluir <strong>{{ toDelete.label }}</strong> do bucket <strong>{{ bucket.id }}</strong>?</p>
    <p class="modal-warn"><Icon name="shield" :size="14" /> Esta ação remove o objeto de todas as réplicas do cluster e não pode ser desfeita.</p>
    <template #foot>
      <button class="btn" @click="toDelete = null">Cancelar</button>
      <button class="btn btn-danger" @click="confirmDelete"><Icon name="trash" :size="16" />Excluir definitivamente</button>
    </template>
  </Modal>

  <Modal v-if="merge" title="Criar PDF" icon="pdf" wide @close="merge = null">
    <p class="modal-text">{{ merge.items.length }} arquivo{{ merge.items.length !== 1 ? 's' : '' }} serão combinados nesta ordem:</p>
    <ul class="merge-grid">
      <li v-for="(it, i) in merge.items" :key="it.key" class="merge-cell" :class="{ 'merge-dragging': dragIdx === i }"
          title="Arraste para reordenar" draggable="true"
          @dragstart="onDragStart(i)" @dragenter.prevent="onDragEnter(i)" @dragover.prevent @dragend="onDragEnd">
        <span class="merge-thumb"><Thumb :bucket-id="bucket.id" :obj-key="it.key" :icon="ICON_FOR[it.type || 'file']" :size="30" /></span>
        <span class="merge-ord">{{ i + 1 }}</span>
        <button class="merge-del" title="Remover" :disabled="merge.items.length <= 1" @click="removeMerge(i)"><Icon name="x" :size="14" /></button>
        <span class="merge-name" :title="it.name">{{ it.name }}</span>
      </li>
    </ul>
    <label class="merge-namefield">
      <span>Nome do arquivo</span>
      <input v-model="merge.name" type="text" placeholder="combinado" @keyup.enter="confirmMerge" />
    </label>
    <template #foot>
      <button class="btn" @click="merge = null">Cancelar</button>
      <button class="btn btn-primary" :disabled="merging || merge.items.length < 1" @click="confirmMerge">
        <Icon name="pdf" :size="16" />{{ merging ? 'Gerando…' : 'Gerar PDF' }}
      </button>
    </template>
  </Modal>
</template>
