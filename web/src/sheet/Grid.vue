<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { colName, coerce, display, editText, type Cell, type CellValue } from './model';

const props = defineProps<{
  cells: Map<string, Cell>;
  rows: number;
  cols: number;
  readonly?: boolean;
  peers: { clientId: number; user: string; row: number; col: number }[];
}>();

const emit = defineEmits<{
  edit: [row: number, col: number, value: CellValue];
  paste: [row: number, col: number, block: CellValue[][]];
  cursor: [row: number, col: number];
}>();

const ROW_H = 26;
const COL_W = 112;
const HEAD_W = 56;
const OVERSCAN = 6;

const viewport = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const scrollLeft = ref(0);
const height = ref(480);
const width = ref(900);

const cursor = ref({ row: 0, col: 0 });
const editing = ref<{ row: number; col: number; text: string } | null>(null);
const cellInput = ref<HTMLInputElement | null>(null);

/** Sempre sobra margem de linhas/colunas além do conteúdo, pra dar onde digitar. */
const totalRows = computed(() => Math.max(props.rows + 24, 40, cursor.value.row + 12));
const totalCols = computed(() => Math.max(props.cols + 6, 16, cursor.value.col + 4));

const firstRow = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_H) - OVERSCAN));
const lastRow = computed(() => Math.min(totalRows.value, Math.ceil((scrollTop.value + height.value) / ROW_H) + OVERSCAN));
const firstCol = computed(() => Math.max(0, Math.floor(scrollLeft.value / COL_W) - 2));
const lastCol = computed(() => Math.min(totalCols.value, Math.ceil((scrollLeft.value + width.value) / COL_W) + 2));

const visibleRows = computed(() => range(firstRow.value, lastRow.value));
const visibleCols = computed(() => range(firstCol.value, lastCol.value));

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i < to; i++) out.push(i);
  return out;
}

const cellAt = (row: number, col: number) => props.cells.get(`R${row}C${col}`);
const textAt = (row: number, col: number) => display(cellAt(row, col));
const isNumeric = (row: number, col: number) => typeof cellAt(row, col)?.v === 'number';

const peerAt = (row: number, col: number) =>
  props.peers.find((p) => p.row === row && p.col === col);

function onScroll(): void {
  const el = viewport.value;
  if (!el) return;
  scrollTop.value = el.scrollTop;
  scrollLeft.value = el.scrollLeft;
  height.value = el.clientHeight;
  width.value = el.clientWidth;
}

function focusCell(row: number, col: number): void {
  cursor.value = { row: Math.max(0, row), col: Math.max(0, col) };
  emit('cursor', cursor.value.row, cursor.value.col);
  scrollIntoView();
}

function scrollIntoView(): void {
  const el = viewport.value;
  if (!el) return;
  const top = cursor.value.row * ROW_H;
  const left = cursor.value.col * COL_W;
  if (top < el.scrollTop) el.scrollTop = top;
  else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
  if (left < el.scrollLeft) el.scrollLeft = left;
  else if (left + COL_W > el.scrollLeft + el.clientWidth) el.scrollLeft = left + COL_W - el.clientWidth;
}

function startEdit(row: number, col: number, initial?: string): void {
  if (props.readonly) return;
  focusCell(row, col);
  editing.value = { row, col, text: initial ?? editText(cellAt(row, col)) };
  void nextTick(() => { cellInput.value?.focus(); cellInput.value?.select(); });
}

function commitEdit(move: 'down' | 'right' | 'none'): void {
  const e = editing.value;
  if (!e) return;
  editing.value = null;
  const before = cellAt(e.row, e.col)?.v ?? null;
  const value = coerce(e.text);
  if ((before ?? null) !== (value ?? null)) emit('edit', e.row, e.col, value);
  if (move === 'down') focusCell(e.row + 1, e.col);
  else if (move === 'right') focusCell(e.row, e.col + 1);
}

function onKey(ev: KeyboardEvent): void {
  if (editing.value) {
    if (ev.key === 'Enter') { ev.preventDefault(); commitEdit('down'); }
    else if (ev.key === 'Tab') { ev.preventDefault(); commitEdit('right'); }
    else if (ev.key === 'Escape') { ev.preventDefault(); editing.value = null; }
    return;
  }

  const { row, col } = cursor.value;
  const step = ev.ctrlKey ? 10 : 1;
  switch (ev.key) {
    case 'ArrowDown': ev.preventDefault(); focusCell(row + step, col); return;
    case 'ArrowUp': ev.preventDefault(); focusCell(row - step, col); return;
    case 'ArrowRight': ev.preventDefault(); focusCell(row, col + step); return;
    case 'ArrowLeft': ev.preventDefault(); focusCell(row, col - step); return;
    case 'Tab': ev.preventDefault(); focusCell(row, ev.shiftKey ? col - 1 : col + 1); return;
    case 'Enter': ev.preventDefault(); startEdit(row, col); return;
    case 'F2': ev.preventDefault(); startEdit(row, col); return;
    case 'Home': ev.preventDefault(); focusCell(row, 0); return;
    case 'Delete':
    case 'Backspace':
      ev.preventDefault();
      if (!props.readonly && cellAt(row, col)) emit('edit', row, col, null);
      return;
    default:
      break;
  }
  // Digitar direto sobre a célula começa a edição substituindo o conteúdo.
  if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key.length === 1) {
    ev.preventDefault();
    startEdit(row, col, ev.key);
  }
}

function onPaste(ev: ClipboardEvent): void {
  if (props.readonly || editing.value) return;
  const text = ev.clipboardData?.getData('text/plain');
  if (!text) return;
  ev.preventDefault();
  const block = text.replace(/\r\n?$/, '').split(/\r\n|\r|\n/).map((line) => line.split('\t').map(coerce));
  if (block.length === 1 && block[0]!.length === 1) emit('edit', cursor.value.row, cursor.value.col, block[0]![0]!);
  else emit('paste', cursor.value.row, cursor.value.col, block);
}

function onCopy(ev: ClipboardEvent): void {
  if (editing.value) return;
  ev.preventDefault();
  const cell = cellAt(cursor.value.row, cursor.value.col);
  ev.clipboardData?.setData('text/plain', editText(cell));
}



defineExpose({ focusCell });
</script>

<template>
  <div
    ref="viewport"
    class="sg"
    tabindex="0"
    @scroll="onScroll"
    @keydown="onKey"
    @paste="onPaste"
    @copy="onCopy"
  >
    <div class="sg-canvas" :style="{ height: totalRows * ROW_H + 'px', width: HEAD_W + totalCols * COL_W + 'px' }">
      <!-- cabeçalho de colunas -->
      <div class="sg-colhead" :style="{ transform: `translateY(${scrollTop}px)`, width: HEAD_W + totalCols * COL_W + 'px' }">
        <div class="sg-corner" :style="{ width: HEAD_W + 'px', transform: `translateX(${scrollLeft}px)` }" />
        <div
          v-for="c in visibleCols" :key="'h' + c"
          class="sg-ch" :class="{ 'is-cur': c === cursor.col }"
          :style="{ left: HEAD_W + c * COL_W + 'px', width: COL_W + 'px' }"
        >{{ colName(c) }}</div>
      </div>

      <!-- cabeçalho de linhas -->
      <div
        v-for="r in visibleRows" :key="'r' + r"
        class="sg-rh" :class="{ 'is-cur': r === cursor.row }"
        :style="{ top: r * ROW_H + 'px', height: ROW_H + 'px', width: HEAD_W + 'px', transform: `translateX(${scrollLeft}px)` }"
      >{{ r + 1 }}</div>

      <!-- células -->
      <template v-for="r in visibleRows" :key="'row' + r">
        <div
          v-for="c in visibleCols" :key="r + ':' + c"
          class="sg-cell"
          :class="{
            'is-cur': r === cursor.row && c === cursor.col,
            'is-num': isNumeric(r, c),
            'has-peer': !!peerAt(r, c),
          }"
          :style="{ top: r * ROW_H + 'px', left: HEAD_W + c * COL_W + 'px', width: COL_W + 'px', height: ROW_H + 'px' }"
          @mousedown="focusCell(r, c)"
          @dblclick="startEdit(r, c)"
        >
          <input
            v-if="editing && editing.row === r && editing.col === c"
            :ref="(el) => { cellInput = el as HTMLInputElement | null; }"
            v-model="editing.text"
            class="sg-input"
            @blur="commitEdit('none')"
          />
          <template v-else>
            <span class="sg-text">{{ textAt(r, c) }}</span>
            <span v-if="peerAt(r, c)" class="sg-peer">{{ peerAt(r, c)!.user }}</span>
          </template>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.sg {
  position: relative;
  overflow: auto;
  height: 100%;
  outline: none;
  background: var(--bg-0);
  font-family: var(--mono);
  font-size: 12.5px;
}
.sg-canvas { position: relative; }

.sg-colhead { position: absolute; top: 0; left: 0; height: 26px; z-index: 3; }
.sg-corner {
  position: absolute; top: 0; left: 0; height: 26px; z-index: 4;
  background: var(--bg-2); border-right: 1px solid var(--line-2); border-bottom: 1px solid var(--line-2);
}
.sg-ch, .sg-rh {
  position: absolute; display: grid; place-items: center;
  background: var(--bg-2); color: var(--text-3);
  font-size: 10.5px; letter-spacing: 1px;
  border-right: 1px solid var(--line); border-bottom: 1px solid var(--line);
}
.sg-ch { top: 0; height: 26px; }
.sg-rh { left: 0; z-index: 2; }
.sg-ch.is-cur, .sg-rh.is-cur { color: var(--neon); background: var(--bg-3); }

.sg-cell {
  position: absolute; display: flex; align-items: center;
  padding: 0 7px; color: var(--text);
  border-right: 1px solid var(--line); border-bottom: 1px solid var(--line);
  overflow: hidden; white-space: nowrap; cursor: cell;
}
.sg-cell.is-num { justify-content: flex-end; font-variant-numeric: tabular-nums; }
.sg-cell.is-cur {
  outline: 2px solid var(--neon); outline-offset: -2px; z-index: 1;
  background: color-mix(in srgb, var(--neon) 8%, transparent);
}
.sg-cell.has-peer { box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--amber) 60%, transparent); }
.sg-text { overflow: hidden; text-overflow: ellipsis; }
.sg-peer {
  position: absolute; top: -1px; right: 2px;
  font-size: 9px; letter-spacing: 0.5px; color: var(--amber);
  background: var(--bg-0); padding: 0 3px; border-radius: 3px;
}
.sg-input {
  width: 100%; height: 100%; border: none; outline: none;
  background: var(--bg-1); color: var(--text);
  font-family: var(--mono); font-size: 12.5px; padding: 0;
}
</style>
