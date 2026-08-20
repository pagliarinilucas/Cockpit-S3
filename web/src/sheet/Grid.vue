<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { colName, coerce, display, editText, type Cell, type CellStyle, type CellValue } from './model';
import { Axis, colAxis, rowAxis } from './geometry';
import { conditionalStyle, contextFrom, todaySerial, type CfRule } from '@sheet/conditional';
import { coveredBy, defaultStyleFor, mergeAt, type SheetLayout } from '@sheet/layout';

export interface Range { top: number; left: number; bottom: number; right: number }

const props = defineProps<{
  cells: Map<string, Cell>;
  styles: Map<string, CellStyle>;
  rows: number;
  cols: number;
  layout?: SheetLayout | null;
  cf?: CfRule[];
  dxfs?: CellStyle[];
  readonly?: boolean;
  light?: boolean;
  peers?: { clientId: number; user: string; row: number; col: number }[];
}>();

const emit = defineEmits<{
  edit: [row: number, col: number, value: CellValue];
  paste: [row: number, col: number, block: CellValue[][]];
  cursor: [row: number, col: number];
  selection: [Range];
}>();

const DEFAULT_COL_W = 112;
const DEFAULT_ROW_H = 26;
const HEAD_W = 56;
const HEAD_H = 26;
const OVERSCAN = 4;

const viewport = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const scrollLeft = ref(0);
const height = ref(480);
const width = ref(900);

const cursor = ref({ row: 0, col: 0 });
const anchor = ref({ row: 0, col: 0 });
const dragging = ref(false);
const editing = ref<{ row: number; col: number; text: string } | null>(null);
const cellInput = ref<HTMLInputElement | null>(null);

const merges = computed(() => props.layout?.merges ?? []);

/** Sempre sobra margem além do conteúdo, pra dar onde digitar. */
const totalRows = computed(() => Math.max(props.rows + 20, 40, cursor.value.row + 12));
const totalCols = computed(() => Math.max(props.cols + 5, 16, cursor.value.col + 4));

const rowAx = computed<Axis>(() => rowAxis(
  totalRows.value,
  props.layout?.defaultRowHeight ?? DEFAULT_ROW_H,
  props.layout?.rows ?? [],
));

const colAx = computed<Axis>(() => colAxis(
  totalCols.value,
  DEFAULT_COL_W,
  props.layout?.cols ?? [],
));

const firstRow = computed(() => Math.max(0, rowAx.value.indexAt(scrollTop.value) - OVERSCAN));
const lastRow = computed(() => Math.min(totalRows.value, rowAx.value.indexAt(scrollTop.value + height.value) + OVERSCAN));
const firstCol = computed(() => Math.max(0, colAx.value.indexAt(scrollLeft.value) - 2));
const lastCol = computed(() => Math.min(totalCols.value, colAx.value.indexAt(scrollLeft.value + width.value) + 2));

const visibleRows = computed(() => range(firstRow.value, lastRow.value));
const visibleCols = computed(() => range(firstCol.value, lastCol.value));

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i < to; i++) out.push(i);
  return out;
}

const selection = computed<Range>(() => ({
  top: Math.min(anchor.value.row, cursor.value.row),
  left: Math.min(anchor.value.col, cursor.value.col),
  bottom: Math.max(anchor.value.row, cursor.value.row),
  right: Math.max(anchor.value.col, cursor.value.col),
}));

const multi = computed(() => selection.value.top !== selection.value.bottom
  || selection.value.left !== selection.value.right);

const cellAt = (row: number, col: number) => props.cells.get(`R${row}C${col}`);

/** Contexto de avaliação das regras condicionais; refeito quando os valores mudam. */
const cfContext = computed(() => contextFrom(props.cells, todaySerial()));

/**
 * Estilo efetivo: o do arquivo (célula, senão o padrão da linha/coluna) com a
 * formatação condicional aplicada por cima — é essa a ordem no Excel.
 */
function styleFor(row: number, col: number): CellStyle | undefined {
  const cell = cellAt(row, col);
  const own = cell?.s !== undefined ? props.styles.get(cell.s) : undefined;
  const fallbackId = own || !props.layout ? undefined : defaultStyleFor(props.layout, row, col);
  const base = own ?? (fallbackId === undefined ? undefined : props.styles.get(String(fallbackId)));

  const rules = props.cf ?? [];
  if (!rules.length) return base;
  const cond = conditionalStyle(rules, props.dxfs ?? [], row, col, cell?.v ?? null, cfContext.value);
  if (!cond) return base;
  return { ...base, ...cond };
}

const textAt = (row: number, col: number) => display(cellAt(row, col), styleFor(row, col));
const isNumeric = (row: number, col: number) => typeof cellAt(row, col)?.v === 'number';

/** Posição e tamanho da célula, já considerando mesclagem. */
function boxOf(row: number, col: number) {
  const merge = mergeAt(merges.value, row, col);
  return {
    top: rowAx.value.offset(row),
    left: HEAD_W + colAx.value.offset(col),
    width: merge ? colAx.value.span(merge.left, merge.right) : colAx.value.size(col),
    height: merge ? rowAx.value.span(merge.top, merge.bottom) : rowAx.value.size(row),
  };
}

function cellCss(row: number, col: number): Record<string, string> {
  const box = boxOf(row, col);
  const s = styleFor(row, col);
  const css: Record<string, string> = {
    top: `${box.top}px`,
    left: `${box.left}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  };
  if (s?.bg) css.background = `#${s.bg}`;
  if (s?.fg) css.color = `#${s.fg}`;
  if (s?.bold) css.fontWeight = '700';
  if (s?.italic) css.fontStyle = 'italic';
  if (s?.underline) css.textDecoration = 'underline';
  if (s?.border) css.boxShadow = 'inset 0 0 0 1px var(--sg-border)';
  if (s?.align) css.justifyContent = s.align === 'right' ? 'flex-end' : s.align === 'center' ? 'center' : 'flex-start';
  else if (isNumeric(row, col)) css.justifyContent = 'flex-end';
  return css;
}

/** Célula coberta por mesclagem não é desenhada — quem ocupa é a âncora. */
const isCovered = (row: number, col: number) => !!coveredBy(merges.value, row, col);

/** Faixa mesclada é selecionada/editada pela âncora. */
function resolveTarget(row: number, col: number): { row: number; col: number } {
  const covering = coveredBy(merges.value, row, col);
  return covering ? { row: covering.top, col: covering.left } : { row, col };
}

const inSelection = (row: number, col: number) => {
  const r = selection.value;
  return row >= r.top && row <= r.bottom && col >= r.left && col <= r.right;
};

const peerAt = (row: number, col: number) => (props.peers ?? []).find((p) => p.row === row && p.col === col);

function onScroll(): void {
  const el = viewport.value;
  if (!el) return;
  scrollTop.value = el.scrollTop;
  scrollLeft.value = el.scrollLeft;
  height.value = el.clientHeight;
  width.value = el.clientWidth;
}

function focusCell(row: number, col: number, extend = false): void {
  const target = resolveTarget(Math.max(0, row), Math.max(0, col));
  cursor.value = target;
  if (!extend) anchor.value = { ...target };
  emit('cursor', target.row, target.col);
  emit('selection', selection.value);
  scrollIntoView();
}

function scrollIntoView(): void {
  const el = viewport.value;
  if (!el) return;
  const top = rowAx.value.offset(cursor.value.row);
  const h = rowAx.value.size(cursor.value.row);
  const left = colAx.value.offset(cursor.value.col);
  const w = colAx.value.size(cursor.value.col);
  if (top < el.scrollTop) el.scrollTop = top;
  else if (top + h > el.scrollTop + el.clientHeight - HEAD_H) el.scrollTop = top + h - el.clientHeight + HEAD_H;
  if (left < el.scrollLeft) el.scrollLeft = left;
  else if (left + w > el.scrollLeft + el.clientWidth - HEAD_W) el.scrollLeft = left + w - el.clientWidth + HEAD_W;
}

/** Linha inteira: até a última coluna usada, com um mínimo pra planilha estreita. */
function selectRow(row: number): void {
  anchor.value = { row, col: 0 };
  cursor.value = { row, col: Math.max(props.cols - 1, 11) };
  emit('cursor', row, 0);
  emit('selection', selection.value);
}

function selectCol(col: number): void {
  anchor.value = { row: 0, col };
  cursor.value = { row: Math.max(props.rows - 1, 29), col };
  emit('cursor', 0, col);
  emit('selection', selection.value);
}

function onCellDown(row: number, col: number, ev: MouseEvent): void {
  dragging.value = true;
  focusCell(row, col, ev.shiftKey);
}

function onCellEnter(row: number, col: number): void {
  if (dragging.value) focusCell(row, col, true);
}

function endDrag(): void { dragging.value = false; }

function startEdit(row: number, col: number, initial?: string): void {
  if (props.readonly) return;
  const target = resolveTarget(row, col);
  focusCell(target.row, target.col);
  editing.value = { ...target, text: initial ?? editText(cellAt(target.row, target.col)) };
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

function clearSelection(): void {
  if (props.readonly) return;
  const r = selection.value;
  for (let row = r.top; row <= r.bottom; row++) {
    for (let col = r.left; col <= r.right; col++) {
      if ((cellAt(row, col)?.v ?? null) !== null) emit('edit', row, col, null);
    }
  }
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
  const extend = ev.shiftKey;
  switch (ev.key) {
    case 'ArrowDown': ev.preventDefault(); focusCell(row + step, col, extend); return;
    case 'ArrowUp': ev.preventDefault(); focusCell(row - step, col, extend); return;
    case 'ArrowRight': ev.preventDefault(); focusCell(row, col + step, extend); return;
    case 'ArrowLeft': ev.preventDefault(); focusCell(row, col - step, extend); return;
    case 'Tab': ev.preventDefault(); focusCell(row, ev.shiftKey ? col - 1 : col + 1); return;
    case 'Enter': case 'F2': ev.preventDefault(); startEdit(row, col); return;
    case 'Home': ev.preventDefault(); focusCell(row, 0, extend); return;
    case 'Delete': case 'Backspace': ev.preventDefault(); clearSelection(); return;
    default: break;
  }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'a') {
    ev.preventDefault();
    anchor.value = { row: 0, col: 0 };
    cursor.value = { row: Math.max(props.rows - 1, 0), col: Math.max(props.cols - 1, 0) };
    emit('selection', selection.value);
    return;
  }
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
  const r = selection.value;
  const lines: string[] = [];
  for (let row = r.top; row <= r.bottom; row++) {
    const cols: string[] = [];
    for (let col = r.left; col <= r.right; col++) cols.push(editText(cellAt(row, col)));
    lines.push(cols.join('\t'));
  }
  ev.clipboardData?.setData('text/plain', lines.join('\n'));
}

defineExpose({ focusCell });
</script>

<template>
  <div
    ref="viewport"
    class="sg"
    :class="{ 'sg-light': light }"
    tabindex="0"
    @scroll="onScroll"
    @keydown="onKey"
    @paste="onPaste"
    @copy="onCopy"
    @mouseup="endDrag"
    @mouseleave="endDrag"
  >
    <div class="sg-canvas" :style="{ height: rowAx.total + 'px', width: HEAD_W + colAx.total + 'px' }">
      <!-- cabeçalho de colunas -->
      <div class="sg-colhead" :style="{ transform: `translateY(${scrollTop}px)`, width: HEAD_W + colAx.total + 'px' }">
        <div class="sg-corner" :style="{ width: HEAD_W + 'px', height: HEAD_H + 'px', transform: `translateX(${scrollLeft}px)` }" />
        <div
          v-for="c in visibleCols" :key="'h' + c"
          class="sg-ch" :class="{ 'is-cur': c >= selection.left && c <= selection.right }"
          :style="{ left: HEAD_W + colAx.offset(c) + 'px', width: colAx.size(c) + 'px', height: HEAD_H + 'px' }"
          title="Clique para selecionar a coluna"
          @mousedown="selectCol(c)"
        >{{ colName(c) }}</div>
      </div>

      <!-- cabeçalho de linhas -->
      <div
        v-for="r in visibleRows" :key="'r' + r"
        class="sg-rh" :class="{ 'is-cur': r >= selection.top && r <= selection.bottom }"
        :style="{ top: rowAx.offset(r) + 'px', height: rowAx.size(r) + 'px', width: HEAD_W + 'px', transform: `translateX(${scrollLeft}px)` }"
        title="Clique para selecionar a linha"
        @mousedown="selectRow(r)"
      >{{ r + 1 }}</div>

      <!-- células -->
      <template v-for="r in visibleRows" :key="'row' + r">
        <div
          v-for="c in visibleCols" :key="r + ':' + c"
          v-show="!isCovered(r, c)"
          class="sg-cell"
          :class="{
            'is-cur': r === cursor.row && c === cursor.col,
            'in-sel': multi && inSelection(r, c),
            'has-peer': !!peerAt(r, c),
            'is-merged': !!mergeAt(merges, r, c),
          }"
          :style="cellCss(r, c)"
          @mousedown="onCellDown(r, c, $event)"
          @mouseenter="onCellEnter(r, c)"
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
/* Tokens do grid: o tema claro só troca estes valores. */
.sg {
  --sg-bg: var(--bg-0);
  --sg-head-bg: var(--bg-2);
  --sg-head-fg: var(--text-3);
  --sg-line: var(--line);
  --sg-text: var(--text);
  --sg-border: var(--text-3);
  --sg-edit-bg: var(--bg-1);

  position: relative;
  overflow: auto;
  height: 100%;
  outline: none;
  background: var(--sg-bg);
  color: var(--sg-text);
  font-family: var(--mono);
  font-size: 12.5px;
}

.sg-light {
  --sg-bg: #ffffff;
  --sg-head-bg: #f1f3f5;
  --sg-head-fg: #5f6b7a;
  --sg-line: #dfe3e8;
  --sg-text: #1f2933;
  --sg-border: #9aa5b1;
  --sg-edit-bg: #ffffff;
}

.sg-canvas { position: relative; }

.sg-colhead { position: absolute; top: 0; left: 0; z-index: 3; }
.sg-corner {
  position: absolute; top: 0; left: 0; z-index: 4;
  background: var(--sg-head-bg);
  border-right: 1px solid var(--sg-line); border-bottom: 1px solid var(--sg-line);
}
.sg-ch, .sg-rh {
  position: absolute; display: grid; place-items: center;
  background: var(--sg-head-bg); color: var(--sg-head-fg);
  font-size: 10.5px; letter-spacing: 1px;
  border-right: 1px solid var(--sg-line); border-bottom: 1px solid var(--sg-line);
  cursor: pointer; user-select: none;
}
.sg-ch { top: 0; }
.sg-rh { left: 0; z-index: 2; }
.sg-ch:hover, .sg-rh:hover { color: var(--neon); }
.sg-ch.is-cur, .sg-rh.is-cur { color: var(--neon); font-weight: 700; }

.sg-cell {
  position: absolute; display: flex; align-items: center;
  padding: 0 7px;
  border-right: 1px solid var(--sg-line); border-bottom: 1px solid var(--sg-line);
  overflow: hidden; white-space: nowrap; cursor: cell;
  font-variant-numeric: tabular-nums;
}
.sg-cell.is-merged { z-index: 1; }
.sg-cell.in-sel { box-shadow: inset 0 0 0 100px color-mix(in srgb, var(--neon) 10%, transparent); }
.sg-cell.is-cur { outline: 2px solid var(--neon); outline-offset: -2px; z-index: 2; }
.sg-cell.has-peer { box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--amber) 60%, transparent); }
.sg-text { overflow: hidden; text-overflow: ellipsis; }
.sg-peer {
  position: absolute; top: -1px; right: 2px;
  font-size: 9px; letter-spacing: 0.5px; color: var(--amber);
  background: var(--sg-bg); padding: 0 3px; border-radius: 3px;
}
.sg-input {
  width: 100%; height: 100%; border: none; outline: none;
  background: var(--sg-edit-bg); color: inherit;
  font-family: var(--mono); font-size: 12.5px; padding: 0;
}
</style>
