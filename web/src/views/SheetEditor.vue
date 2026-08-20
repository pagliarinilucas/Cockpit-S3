<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import Icon from '../components/Icon.vue';
import Grid from '../sheet/Grid.vue';
import { countCells, type Range } from '../sheet/selection';
import FormatBar from '../sheet/FormatBar.vue';
import { SheetSession, type Peer, type Presence, type Status } from '../sheet/session';
import { cellRef, parseCellKey, type Cell, type CellStyle, type CellValue } from '../sheet/model';
import { useToast } from '../core/toast';

const props = defineProps<{ bucketId: string; objectKey: string; user: string }>();
const emit = defineEmits<{ close: [] }>();
const toast = useToast();

const status = ref<Status>('conectando');
const sheets = ref<string[]>([]);
const active = ref('');
const peers = ref<Peer[]>([]);
const cursors = shallowRef(new Map<number, Presence>());
const cells = shallowRef(new Map<string, Cell>());
const styles = shallowRef(new Map<string, CellStyle>());
const bounds = ref({ rows: 0, cols: 0 });
const ranges = ref<Range[]>([{ top: 0, left: 0, bottom: 0, right: 0 }]);
const render = shallowRef<Record<string, SheetRender>>({});
const dxfs = shallowRef<CellStyle[]>([]);
// Preferência de tema do grid, lembrada entre sessões.
const light = ref(localStorage.getItem('cs3.sheet.light') === '1');

const sheetRender = computed<SheetRender | undefined>(() => render.value[active.value]);

function toggleLight(): void {
  light.value = !light.value;
  localStorage.setItem('cs3.sheet.light', light.value ? '1' : '0');
}
const diverged = ref(false);
const dirty = ref(false);
const savedAt = ref<string | null>(null);
const cursor = ref({ row: 0, col: 0 });

const name = computed(() => props.objectKey.split('/').pop() || props.objectKey);
const readonly = computed(() => diverged.value);
const others = computed(() => peers.value.filter((p) => p.user !== props.user));

const peerCursors = computed(() => [...cursors.value.entries()]
  .filter(([, p]) => p.sheet === active.value)
  .map(([clientId, p]) => ({ clientId, user: p.user, row: p.row, col: p.col })));

let session: SheetSession | null = null;

/** O Y.Map não é reativo pro Vue, então cada mudança materializa um Map novo. */
function refresh(): void {
  if (!session || !active.value) return;
  const next = new Map<string, Cell>();
  let rows = 0;
  let cols = 0;
  for (const [k, cell] of session.sheetMap(active.value).entries()) {
    if (!cell) continue;
    next.set(k, cell);
    const pos = parseCellKey(k);
    if (!pos) continue;
    rows = Math.max(rows, pos.row + 1);
    cols = Math.max(cols, pos.col + 1);
  }
  cells.value = next;
  styles.value = new Map(session.stylesMap().entries());
  bounds.value = { rows, cols };
}

/** Formatação mostrada na barra: a da célula sob o cursor. */
const currentStyle = computed<CellStyle>(() => {
  const cell = cells.value.get(`R${cursor.value.row}C${cursor.value.col}`);
  return (cell?.s === undefined ? undefined : styles.value.get(cell.s)) ?? {};
});

function onSelection(r: Range[]): void { ranges.value = r; }

/** Quantas células a formatação vai atingir — confirma a seleção solta. */
const selectedCount = computed(() => countCells(ranges.value));

function applyFormat(change: Partial<CellStyle>): void {
  if (readonly.value) return;
  session?.applyStyle(active.value, ranges.value, change);
  dirty.value = true;
}

function selectSheet(sheetName: string): void {
  active.value = sheetName;
  refresh();
}

function onFormula(row: number, col: number, formula: string): void {
  if (readonly.value) return;
  session?.setFormula(active.value, row, col, formula);
  dirty.value = true;
}

function onEdit(row: number, col: number, value: CellValue): void {
  if (readonly.value) return;
  session?.setCell(active.value, row, col, value);
  dirty.value = true;
}

function onPasteBlock(row: number, col: number, block: CellValue[][]): void {
  if (readonly.value) return;
  session?.setBlock(active.value, row, col, block);
  dirty.value = true;
}

function onCursor(row: number, col: number): void {
  cursor.value = { row, col };
  session?.sendPresence({ user: props.user, sheet: active.value, row, col });
}

function saveNow(): void {
  session?.requestSave();
}

onMounted(() => {
  session = new SheetSession(props.bucketId, props.objectKey, {
    onStatus: (s) => { status.value = s; },
    onReady: ({ sheets: names, diverged: div, peers: list, layout, dxfs: diff }) => {
      sheets.value = names;
      peers.value = list;
      diverged.value = div;
      render.value = layout ?? {};
      dxfs.value = diff ?? [];
      if (!active.value && names.length) active.value = names[0]!;
      refresh();
      if (div) toast.error('Este arquivo foi alterado fora do editor — abrindo em leitura');
    },
    onPeers: (list) => { peers.value = list; },
    onPresence: (clientId, p) => {
      const next = new Map(cursors.value);
      next.set(clientId, p);
      cursors.value = next;
    },
    onSaved: (changed) => {
      dirty.value = false;
      savedAt.value = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      if (changed) toast.success(`Salvo (${changed} célula${changed > 1 ? 's' : ''})`);
    },
    onUnchanged: () => { dirty.value = false; },
    onDiverged: () => {
      diverged.value = true;
      toast.error('Arquivo alterado fora do editor: nada foi sobrescrito');
    },
    onError: (message) => toast.error(msgFor(message)),
    onChange: refresh,
  });
  void session.connect();
});

onBeforeUnmount(() => { session?.close(); session = null; });

function msgFor(code: string): string {
  if (code === 'sealed') return 'Criptografia indisponível (KEK não configurada)';
  if (code === 'planilha_grande') return 'Planilha grande demais para o editor';
  if (code === 'sem_permissao') return 'Você não tem mais permissão de escrita aqui';
  if (code === 'ticket_invalido') return 'Sessão expirada — feche e abra de novo';
  if (code === 'protocolo_binario') return 'Servidor mandou o documento em formato inválido';
  return code;
}

const STATUS_LABEL: Record<Status, string> = {
  conectando: 'conectando',
  ligado: 'ao vivo',
  reconectando: 'reconectando',
  fechado: 'desconectado',
};
</script>

<template>
  <div class="se">
    <header class="se-top">
      <button class="iconbtn iconbtn-lg" title="Fechar" @click="emit('close')">
        <Icon name="x" :size="18" />
      </button>
      <div class="se-id">
        <span class="se-name">{{ name }}</span>
        <span class="se-cell">{{ cellRef(cursor.row, cursor.col) }}</span>
        <span v-if="selectedCount > 1" class="se-count">{{ selectedCount.toLocaleString('pt-BR') }} células</span>
      </div>

      <div class="se-status" :class="'st-' + status">
        <span class="se-dot" />{{ STATUS_LABEL[status] }}
      </div>

      <div v-if="others.length" class="se-peers">
        <span v-for="p in others" :key="p.id" class="se-peer" :title="p.user">{{ p.user.slice(0, 2).toUpperCase() }}</span>
      </div>

      <div class="se-spacer" />

      <span v-if="diverged" class="se-warn">
        <Icon name="eye" :size="14" /> leitura — arquivo alterado fora do editor
      </span>
      <span v-else-if="dirty" class="se-hint">alterações não salvas</span>
      <span v-else-if="savedAt" class="se-hint">salvo às {{ savedAt }}</span>

      <button
        class="iconbtn iconbtn-lg" :title="light ? 'Tema escuro na planilha' : 'Tema claro na planilha'"
        @click="toggleLight"
      >
        <Icon name="palette" :size="17" />
      </button>

      <button class="btn btn-primary" :disabled="diverged || status !== 'ligado'" @click="saveNow">
        <Icon name="upload" :size="16" />Salvar agora
      </button>
    </header>

    <FormatBar :current="currentStyle" :disabled="readonly || status !== 'ligado'" @apply="applyFormat" />

    <Grid
      v-if="active"
      :cells="cells"
      :styles="styles"
      :rows="bounds.rows"
      :cols="bounds.cols"
      :layout="sheetRender?.layout ?? null"
      :cf="sheetRender?.cf ?? []"
      :dxfs="dxfs"
      :readonly="readonly"
      :light="light"
      :peers="peerCursors"
      @edit="onEdit"
      @formula="onFormula"
      @paste="onPasteBlock"
      @cursor="onCursor"
      @selection="onSelection"
    />
    <div v-else class="se-loading">carregando planilha…</div>

    <footer v-if="sheets.length" class="se-tabs">
      <button
        v-for="s in sheets" :key="s"
        class="se-tab" :class="{ 'is-active': s === active }"
        @click="selectSheet(s)"
      >{{ s }}</button>
    </footer>
  </div>
</template>

<style scoped>
.se {
  position: fixed; inset: 0; z-index: 60;
  display: grid; grid-template-rows: 56px auto 1fr auto;
  background: var(--bg-0);
}

.se-top {
  display: flex; align-items: center; gap: 12px;
  padding: 0 14px; border-bottom: 1px solid var(--line-2); background: var(--bg-1);
}
.se-id { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.se-name {
  font-family: var(--display-font); font-weight: 700; font-size: 15px; letter-spacing: 0.4px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 42vw;
}
.se-cell { font-family: var(--mono); font-size: 11px; color: var(--neon); letter-spacing: 1px; }
.se-count { font-family: var(--mono); font-size: 10.5px; color: var(--text-3); letter-spacing: 0.6px; }
.se-spacer { flex: 1; }

.se-status {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--mono); font-size: 10px; letter-spacing: 1.4px; text-transform: uppercase;
  color: var(--text-3);
}
.se-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.st-ligado { color: var(--green); }
.st-conectando, .st-reconectando { color: var(--amber); }
.st-fechado { color: var(--danger); }

.se-peers { display: flex; gap: 4px; }
.se-peer {
  display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%;
  background: color-mix(in srgb, var(--amber) 18%, var(--bg-2));
  border: 1px solid color-mix(in srgb, var(--amber) 45%, transparent);
  color: var(--amber); font-family: var(--mono); font-size: 10px;
}

.se-hint { font-size: 11.5px; color: var(--text-3); }
.se-warn {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11.5px; color: var(--amber);
}

.se-loading { display: grid; place-items: center; color: var(--text-3); font-family: var(--mono); font-size: 12px; }

.se-tabs {
  display: flex; gap: 2px; align-items: center;
  padding: 6px 10px; border-top: 1px solid var(--line-2); background: var(--bg-1);
  overflow-x: auto;
}
.se-tab {
  border: 1px solid transparent; background: transparent; color: var(--text-2);
  padding: 6px 12px; border-radius: 8px 8px 0 0; cursor: pointer;
  font-family: var(--display-font); font-size: 12.5px; white-space: nowrap;
}
.se-tab:hover { color: var(--text); background: var(--bg-2); }
.se-tab.is-active {
  color: var(--neon); background: var(--bg-2);
  border-color: var(--line-2); border-bottom-color: transparent;
}
</style>
