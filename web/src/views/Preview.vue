<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import type { ObjectItem, Perm } from '../core/models';
import { api } from '../core/api';
import { fmtBytes, timeAgo, ICON_FOR } from '../core/util';
import Icon from '../components/Icon.vue';
import PermBadge from '../components/PermBadge.vue';
import { isSheetName } from '../sheet/model';

const props = defineProps<{
  bucketId: string; bucketPerm: Perm; path: string;
  items: ObjectItem[]; startKey: string; canWrite: boolean; canDownload: boolean;
}>();
const emit = defineEmits<{ close: []; download: [ObjectItem]; copyLink: [ObjectItem]; delete: [ObjectItem]; edit: [ObjectItem] }>();

/** Planilha editável abre o editor colaborativo; quem só lê não vê o botão. */
const editable = (it: ObjectItem) => it.kind === 'file' && props.canWrite && isSheetName(it.name);

const MAX_ROWS = 5000;   // cap rendered rows so huge sheets don't freeze the tab

const idx = ref(0);
const url = ref<string | null>(null);
const loading = ref(false);
const failed = ref(false);
const wave = Array.from({ length: 64 }, (_, i) => 12 + Math.round((Math.sin(i * 0.7) * 0.5 + 0.5) * 80));

// spreadsheet state
// for extension-less files: detect what it actually is from the bytes
const fileKind = ref<'image' | 'pdf' | 'none' | null>(null);

const sheetNames = ref<string[]>([]);
const activeSheet = ref('');
const sheetRows = ref<string[][]>([]);
const sheetTruncated = ref(false);
let workbook: import('xlsx').WorkBook | null = null;
let xlsxMod: typeof import('xlsx') | null = null;   // lazily imported; kept for sync sheet switching

const item = computed<ObjectItem | null>(() => props.items[idx.value] ?? null);

function revoke() { if (url.value) { URL.revokeObjectURL(url.value); url.value = null; } }
function resetSheet() { workbook = null; sheetNames.value = []; activeSheet.value = ''; sheetRows.value = []; sheetTruncated.value = false; }

async function loadSheet(it: ObjectItem) {
  if (!xlsxMod) xlsxMod = await import('xlsx');
  const blob = await api.objectBlob(props.bucketId, it.key, 'preview');
  const ext = (it.name.split('.').pop() || '').toLowerCase();
  workbook = (ext === 'csv' || ext === 'tsv')
    ? xlsxMod.read(await blob.text(), { type: 'string' })
    : xlsxMod.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
  sheetNames.value = workbook.SheetNames;
  selectSheet(workbook.SheetNames[0] ?? '');
}

function selectSheet(name: string) {
  if (!workbook || !xlsxMod || !name) return;
  activeSheet.value = name;
  const aoa = xlsxMod.utils.sheet_to_json(workbook.Sheets[name], { header: 1, blankrows: false, defval: '' }) as unknown[][];
  sheetTruncated.value = aoa.length > MAX_ROWS;
  sheetRows.value = aoa.slice(0, MAX_ROWS).map((r) => (r ?? []).map((c) => c == null ? '' : String(c)));
}

/** Detect kind + MIME from the first bytes — for files saved without an extension.
 *  Returns a precise MIME so the rebuilt blob renders even if the server sent octet-stream. */
async function sniff(blob: Blob): Promise<{ kind: 'image' | 'pdf' | 'none'; mime: string }> {
  const b = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { kind: 'pdf', mime: 'application/pdf' };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { kind: 'image', mime: 'image/png' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', mime: 'image/jpeg' };
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { kind: 'image', mime: 'image/gif' };
  if (b[0] === 0x42 && b[1] === 0x4d) return { kind: 'image', mime: 'image/bmp' };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return { kind: 'image', mime: 'image/webp' };
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return { kind: 'image', mime: 'image/avif' };
  if (b[0] === 0x3c) return { kind: 'image', mime: 'image/svg+xml' };
  return { kind: 'none', mime: '' };
}

async function load() {
  const it = item.value;
  if (!it) return;
  loading.value = true; failed.value = false; revoke(); resetSheet(); fileKind.value = null;
  try {
    if (it.type === 'sheet') { await loadSheet(it); return; }
    const blob = await api.objectBlob(props.bucketId, it.key, 'preview');
    if (it.type === 'file') {
      const { kind, mime } = await sniff(blob);
      fileKind.value = kind;
      if (kind === 'none') return;                        // name-only screen, no object URL needed
      url.value = URL.createObjectURL(new Blob([blob], { type: mime }));   // force the right MIME
      return;
    }
    url.value = URL.createObjectURL(blob);
  } catch { failed.value = true; }
  finally { loading.value = false; }
}

function go(d: number) {
  if (!props.items.length) return;
  idx.value = (idx.value + d + props.items.length) % props.items.length;
  load();
}

watch(() => [props.startKey, props.items], () => {
  idx.value = Math.max(0, props.items.findIndex((x) => x.key === props.startKey));
  load();
}, { immediate: true });

const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') emit('close');
  else if (e.key === 'ArrowRight') go(1);
  else if (e.key === 'ArrowLeft') go(-1);
};
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); revoke(); });

const fullPath = (it: ObjectItem) => props.bucketId + '/' + it.key;
const iconFor = (it: ObjectItem) => ICON_FOR[it.type || 'file'];
</script>

<template>
  <div class="pv-back" @click="emit('close')">
    <button v-if="items.length > 1" class="pv-nav pv-prev" @click.stop="go(-1)"><Icon name="chevL" :size="26" /></button>

    <div class="pv-shell" @click.stop>
      <template v-if="item">
        <div class="pv-head">
          <div class="pv-head-l">
            <div :class="'pv-head-ic ft-' + (item.type || 'file')"><Icon :name="iconFor(item)" :size="18" /></div>
            <div class="pv-head-txt">
              <div class="pv-head-name">{{ item.name }}</div>
              <div class="pv-head-path">{{ fullPath(item) }}</div>
            </div>
          </div>
          <div class="pv-head-r">
            <button v-if="editable(item)" class="btn btn-primary" @click="emit('edit', item)"><Icon name="edit" :size="16" />Editar</button>
            <button v-if="canDownload" class="btn" @click="emit('download', item)"><Icon name="download" :size="16" />Download</button>
            <button v-if="canDownload" class="btn" @click="emit('copyLink', item)"><Icon name="copy" :size="16" />Link</button>
            <button v-if="canWrite" class="iconbtn iconbtn-danger" title="Excluir" @click="emit('delete', item); emit('close')"><Icon name="trash" :size="17" /></button>
            <button class="iconbtn iconbtn-lg" @click="emit('close')"><Icon name="x" :size="18" /></button>
          </div>
        </div>

        <div class="pv-stage">
          <div class="pv-body">
            <div v-if="loading" class="pv-loading"><div class="spinner"></div>ABRINDO…</div>
            <div v-else-if="failed" class="pv-loading"><Icon name="alert" :size="34" />Não foi possível abrir a prévia.</div>
            <div v-else-if="item.type === 'sheet'" class="pv-sheet">
              <div v-if="sheetNames.length > 1" class="pv-sheet-tabs">
                <button v-for="s in sheetNames" :key="s" class="pv-sheet-tab" :class="{ 'pv-sheet-tab-on': s === activeSheet }" @click="selectSheet(s)">{{ s }}</button>
              </div>
              <div class="pv-sheet-scroll">
                <table class="pv-table">
                  <tbody>
                    <tr v-for="(row, r) in sheetRows" :key="r">
                      <td class="pv-table-rownum">{{ r + 1 }}</td>
                      <td v-for="(cell, c) in row" :key="c">{{ cell }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-if="sheetTruncated" class="pv-sheet-note"><Icon name="alert" :size="13" /> mostrando as primeiras 5000 linhas</div>
            </div>
            <template v-else-if="item.type === 'file'">
              <iframe v-if="fileKind === 'pdf'" :src="url || ''"></iframe>
              <img v-else-if="fileKind === 'image' && url" :src="url" :alt="item.name" @error="fileKind = 'none'" />
              <div v-else class="pv-noprev">
                <Icon name="file" :size="46" />
                <div class="pv-noprev-name">{{ item.name }}</div>
                <div class="pv-noprev-sub">Sem prévia para este arquivo</div>
                <button v-if="canDownload" class="btn" @click="emit('download', item)"><Icon name="download" :size="16" />Baixar</button>
              </div>
            </template>
            <template v-else-if="url">
              <img v-if="item.type === 'image'" :src="url" :alt="item.name" />
              <video v-else-if="item.type === 'video'" :src="url" controls autoplay></video>
              <iframe v-else-if="item.type === 'pdf' || item.type === 'text' || item.type === 'code'" :src="url"></iframe>
              <div v-else-if="item.type === 'audio'" class="pv-audio-stage">
                <div class="pv-wave"><span v-for="(h, i) in wave" :key="i" :style="{ height: h + '%' }"></span></div>
                <audio :src="url" controls autoplay></audio>
              </div>
              <div v-else class="pv-loading"><Icon name="file" :size="34" />Sem prévia para este tipo.</div>
            </template>
          </div>

          <aside class="pv-info">
            <div class="pv-info-row"><span>TIPO</span><b>{{ (item.type || 'file').toUpperCase() }}</b></div>
            <div class="pv-info-row"><span>TAMANHO</span><b>{{ fmtBytes(item.size) }}</b></div>
            <div v-if="item.modified" class="pv-info-row"><span>MODIFICADO</span><b>{{ timeAgo(item.modified) }} atrás</b></div>
            <div v-if="item.by" class="pv-info-row"><span>AUTOR</span><b>{{ item.by }}</b></div>
            <div class="pv-info-sep"></div>
            <div><PermBadge :perm="bucketPerm" :small="true" /></div>
            <div class="pv-info-counter">{{ idx + 1 }} de {{ items.length }} · use ← →</div>
          </aside>
        </div>
      </template>
    </div>

    <button v-if="items.length > 1" class="pv-nav pv-next" @click.stop="go(1)"><Icon name="chevR" :size="26" /></button>
  </div>
</template>
