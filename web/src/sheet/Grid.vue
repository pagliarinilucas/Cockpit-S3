<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import {
  colName, coerce, display, editText, formulaOf, isFormulaInput,
  type Cell, type CellStyle, type CellValue,
} from './model';
import { Axis, colAxis, rowAxis } from './geometry';
import { inkFor } from './contrast';
import {
  cellsOf, colTouched, contains, isMulti, rangeOf, rowTouched, wholeCol, wholeRow,
  type Range,
} from './selection';
import {
  conditionalVisual, contextFrom, todaySerial, type CfRule, type CfVisual,
} from '@sheet/conditional';
import { coveredBy, defaultStyleFor, mergeAt, type SheetLayout } from '@sheet/layout';

// O modelo de seleção vive em selection.ts (testável sem DOM).
export type { Range };

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
  /** Fórmula digitada (sem o "="), a ser calculada pela sessão. */
  formula: [row: number, col: number, formula: string];
  paste: [row: number, col: number, block: CellValue[][]];
  cursor: [row: number, col: number];
  /** Todas as faixas selecionadas — com Ctrl dá para juntar faixas soltas. */
  selection: [Range[]];
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

/**
 * Linhas/colunas desenhadas: a janela visível MAIS a faixa congelada, que
 * precisa existir no DOM mesmo quando a rolagem já passou dela.
 */
const visibleRows = computed(() => withFrozen(
  range(firstRow.value, lastRow.value),
  props.layout?.frozenRows ?? 0,
));
const visibleCols = computed(() => withFrozen(
  range(firstCol.value, lastCol.value),
  props.layout?.frozenCols ?? 0,
));

function withFrozen(window: number[], frozen: number): number[] {
  if (frozen <= 0) return window;
  const head = range(0, frozen);
  const rest = window.filter((i) => i >= frozen);
  return [...head, ...rest];
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i < to; i++) out.push(i);
  return out;
}

/** Faixa em construção (âncora até o cursor). */
const active = computed<Range>(() => rangeOf(anchor.value, cursor.value));

/** Faixas já fixadas com Ctrl; a ativa entra por cima na hora de usar. */
const pinned = ref<Range[]>([]);
const selection = computed<Range[]>(() => [...pinned.value, active.value]);

const multi = computed(() => isMulti(selection.value));

function emitSelection(): void { emit('selection', selection.value); }

/** Fixa a faixa atual e começa outra — é o Ctrl+clique do Excel. */
function pinActive(): void { pinned.value = [...pinned.value, active.value]; }

const cellAt = (row: number, col: number) => props.cells.get(`R${row}C${col}`);

/** Contexto de avaliação das regras condicionais; refeito quando os valores mudam. */
const cfContext = computed(() => contextFrom(props.cells, todaySerial()));

/**
 * Estilo efetivo: o do arquivo (célula, senão o padrão da linha/coluna) com a
 * formatação condicional aplicada por cima — é essa a ordem no Excel.
 */
/** Visual condicional da célula (estilo, barra, escala ou ícone). */
function visualFor(row: number, col: number): CfVisual | null {
  const rules = props.cf ?? [];
  if (!rules.length) return null;
  const value = cellAt(row, col)?.v ?? null;
  return conditionalVisual(rules, props.dxfs ?? [], row, col, value, cfContext.value);
}

function styleFor(row: number, col: number): CellStyle | undefined {
  const cell = cellAt(row, col);
  const own = cell?.s !== undefined ? props.styles.get(cell.s) : undefined;
  const fallbackId = own || !props.layout ? undefined : defaultStyleFor(props.layout, row, col);
  const base = own ?? (fallbackId === undefined ? undefined : props.styles.get(String(fallbackId)));

  const visual = visualFor(row, col);
  if (!visual) return base;
  // Estilo condicional entra por cima; escala de cores substitui só o fundo.
  if (visual.kind === 'style') return { ...base, ...visual.style };
  if (visual.kind === 'colorScale') return { ...base, bg: visual.color };
  return base;
}

/** Barra de dados da célula, quando a regra é desse tipo. */
const barAt = (row: number, col: number) => {
  const visual = visualFor(row, col);
  return visual?.kind === 'dataBar' ? visual : null;
};

const iconAt = (row: number, col: number) => {
  const visual = visualFor(row, col);
  return visual?.kind === 'iconSet' ? visual.icon : null;
};

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
  // Sem cor de fonte no arquivo, ela vem do preenchimento: no tema escuro o
  // texto padrão é claro e ficaria ilegível sobre um amarelo do arquivo.
  if (s?.fg) css.color = `#${s.fg}`;
  else if (s?.bg) css.color = inkFor(s.bg);
  if (s?.bold) css.fontWeight = '700';
  if (s?.italic) css.fontStyle = 'italic';
  if (s?.underline) css.textDecoration = 'underline';
  if (s?.fontName) css.fontFamily = `"${s.fontName}", var(--mono)`;
  if (s?.fontSize) css.fontSize = `${Math.round(s.fontSize * (4 / 3))}px`;
  if (s?.indent) css.paddingLeft = `${7 + s.indent * 8}px`;

  if (s?.wrap) {
    css.whiteSpace = 'pre-wrap';
    css.wordBreak = 'break-word';
  }

  // Vertical: o padrão do Excel é embaixo; o nosso, centralizado (fica melhor
  // em linha de altura padrão). Só muda quando o arquivo pede.
  if (s?.vAlign === 'top') css.alignItems = 'flex-start';
  else if (s?.vAlign === 'bottom') css.alignItems = 'flex-end';

  // Bordas lado a lado do arquivo; sem detalhe, a borda uniforme do editor.
  if (s?.borders) Object.assign(css, borderCss(s.borders));
  else if (s?.border) css.boxShadow = 'inset 0 0 0 1px var(--sg-border)';

  if (s?.align) css.justifyContent = s.align === 'right' ? 'flex-end' : s.align === 'center' ? 'center' : 'flex-start';
  else if (isNumeric(row, col)) css.justifyContent = 'flex-end';

  Object.assign(css, frozenCss(row, col));
  // Célula congelada precisa ser opaca para o conteúdo que passa por baixo não
  // aparecer atrás dela — mas sem apagar o preenchimento do arquivo.
  if (!s?.bg && isFrozen(row, col)) css.background = 'var(--sg-bg)';
  return css;
}

/** Espessura aproximada de cada estilo de borda do OOXML. */
const BORDER_WIDTH: Record<string, string> = {
  hair: '1px', thin: '1px', dotted: '1px', dashed: '1px', dashDot: '1px', dashDotDot: '1px',
  medium: '2px', mediumDashed: '2px', mediumDashDot: '2px', mediumDashDotDot: '2px', slantDashDot: '2px',
  thick: '3px', double: '3px',
};

const BORDER_LINE: Record<string, string> = {
  dotted: 'dotted', dashed: 'dashed', dashDot: 'dashed', dashDotDot: 'dashed',
  mediumDashed: 'dashed', mediumDashDot: 'dashed', mediumDashDotDot: 'dashed',
  double: 'double', hair: 'solid',
};

const SIDE_PROP = { top: 'borderTop', right: 'borderRight', bottom: 'borderBottom', left: 'borderLeft' } as const;

function borderCss(borders: NonNullable<CellStyle['borders']>): Record<string, string> {
  const css: Record<string, string> = {};
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const edge = borders[side];
    if (!edge) continue;
    const width = BORDER_WIDTH[edge.style] ?? '1px';
    const line = BORDER_LINE[edge.style] ?? 'solid';
    const color = edge.color ? `#${edge.color}` : 'var(--sg-border)';
    css[SIDE_PROP[side]] = `${width} ${line} ${color}`;
  }
  return css;
}

/**
 * Painel congelado: as células da faixa travada acompanham o scroll no eixo
 * correspondente, o mesmo truque dos cabeçalhos.
 */
function frozenCss(row: number, col: number): Record<string, string> {
  const rows = props.layout?.frozenRows ?? 0;
  const cols = props.layout?.frozenCols ?? 0;
  const frozenRow = rows > 0 && row < rows;
  const frozenCol = cols > 0 && col < cols;
  if (!frozenRow && !frozenCol) return {};
  const x = frozenCol ? scrollLeft.value : 0;
  const y = frozenRow ? scrollTop.value : 0;
  return {
    transform: `translate(${x}px, ${y}px)`,
    zIndex: String(frozenRow && frozenCol ? 5 : frozenRow ? 4 : 3),
  };
}

const isFrozen = (row: number, col: number): boolean =>
  row < (props.layout?.frozenRows ?? 0) || col < (props.layout?.frozenCols ?? 0);

/** Célula coberta por mesclagem não é desenhada — quem ocupa é a âncora. */
const isCovered = (row: number, col: number) => !!coveredBy(merges.value, row, col);

/** Faixa mesclada é selecionada/editada pela âncora. */
function resolveTarget(row: number, col: number): { row: number; col: number } {
  const covering = coveredBy(merges.value, row, col);
  return covering ? { row: covering.top, col: covering.left } : { row, col };
}

const inSelection = (row: number, col: number) => contains(selection.value, row, col);

/** Cabeçalho aceso quando a linha/coluna toca qualquer faixa selecionada. */
const rowSelected = (row: number) => rowTouched(selection.value, row);
const colSelected = (col: number) => colTouched(selection.value, col);

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
  emitSelection();
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

const additive = (ev: MouseEvent | KeyboardEvent) => ev.ctrlKey || ev.metaKey;

/** Linha inteira: até a última coluna usada, com um mínimo pra planilha estreita. */
function selectRow(row: number, ev: MouseEvent): void {
  if (additive(ev)) pinActive();
  else pinned.value = [];
  const r = wholeRow(row, props.cols);
  anchor.value = { row: r.top, col: r.left };
  cursor.value = { row: r.bottom, col: r.right };
  emit('cursor', row, 0);
  emitSelection();
}

function selectCol(col: number, ev: MouseEvent): void {
  if (additive(ev)) pinActive();
  else pinned.value = [];
  const r = wholeCol(col, props.rows);
  anchor.value = { row: r.top, col: r.left };
  cursor.value = { row: r.bottom, col: r.right };
  emit('cursor', 0, col);
  emitSelection();
}

function onCellDown(row: number, col: number, ev: MouseEvent): void {
  dragging.value = true;
  // Ctrl fixa o que já estava selecionado e abre uma faixa nova; sem Ctrl,
  // recomeça. Shift estende a faixa atual, como no Excel.
  if (additive(ev)) pinActive();
  else if (!ev.shiftKey) pinned.value = [];
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
  const cell = cellAt(e.row, e.col);

  if (isFormulaInput(e.text)) {
    const formula = formulaOf(e.text);
    if (formula !== (cell?.f ?? '')) emit('formula', e.row, e.col, formula);
  } else {
    const value = coerce(e.text);
    // Trocar fórmula por valor literal também é mudança, mesmo que o resultado
    // exibido seja o mesmo número.
    if ((cell?.v ?? null) !== (value ?? null) || cell?.f) emit('edit', e.row, e.col, value);
  }

  if (move === 'down') focusCell(e.row + 1, e.col);
  else if (move === 'right') focusCell(e.row, e.col + 1);
}

function clearSelection(): void {
  if (props.readonly) return;
  for (const { row, col } of cellsOf(selection.value)) {
    if ((cellAt(row, col)?.v ?? null) !== null) emit('edit', row, col, null);
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
  if (additive(ev) && ev.key.toLowerCase() === 'a') {
    ev.preventDefault();
    pinned.value = [];
    anchor.value = { row: 0, col: 0 };
    cursor.value = { row: Math.max(props.rows - 1, 0), col: Math.max(props.cols - 1, 0) };
    emitSelection();
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
  // Faixas soltas não têm forma retangular para colar; copia a faixa ativa,
  // que é a última em que o cursor está (o Excel simplesmente recusa).
  const r = active.value;
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
          class="sg-ch" :class="{ 'is-cur': colSelected(c) }"
          :style="{ left: HEAD_W + colAx.offset(c) + 'px', width: colAx.size(c) + 'px', height: HEAD_H + 'px' }"
          title="Clique para selecionar a coluna"
          @mousedown="selectCol(c, $event)"
        >{{ colName(c) }}</div>
      </div>

      <!-- cabeçalho de linhas -->
      <div
        v-for="r in visibleRows" :key="'r' + r"
        class="sg-rh" :class="{ 'is-cur': rowSelected(r) }"
        :style="{ top: rowAx.offset(r) + 'px', height: rowAx.size(r) + 'px', width: HEAD_W + 'px', transform: `translateX(${scrollLeft}px)` }"
        title="Clique para selecionar a linha"
        @mousedown="selectRow(r, $event)"
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
            <span
              v-if="barAt(r, c)"
              class="sg-bar"
              :style="{ width: `${Math.round(barAt(r, c)!.ratio * 100)}%`, background: `#${barAt(r, c)!.color}` }"
            />
            <span v-if="iconAt(r, c)" class="sg-icon">{{ iconAt(r, c) }}</span>
            <span v-if="!barAt(r, c)?.hideValue" class="sg-text">{{ textAt(r, c) }}</span>
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
.sg-text { overflow: hidden; text-overflow: ellipsis; position: relative; }
/* Barra de dados: fica atrás do texto, alinhada à esquerda da célula. */
.sg-bar {
  position: absolute; left: 0; top: 2px; bottom: 2px;
  border-radius: 2px; opacity: 0.55; pointer-events: none;
}
.sg-icon { margin-right: 5px; font-size: 11px; line-height: 1; }
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
