// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Geometria e metadados de exibição da aba: células mescladas, largura de
 * coluna, altura de linha, estilo padrão de linha/coluna e painel congelado.
 * Nada disso é editado pelo editor (ainda), então viaja como layout estático da
 * sessão em vez de entrar no documento colaborativo.
 *
 * Unidades do OOXML: largura de coluna é em "caracteres" da fonte padrão e
 * altura de linha é em pontos — a conversão para pixel fica aqui, num lugar só.
 */
import { parseCellRef } from './model';

export interface MergeRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface ColLayout {
  /** Faixa de colunas (0-based, inclusive). */
  from: number;
  to: number;
  /** Largura em pixels, já convertida. */
  width?: number;
  hidden?: boolean;
  /** Índice de cellXfs padrão das células desta coluna. */
  style?: number;
}

export interface RowLayout {
  row: number;
  /** Altura em pixels, já convertida. */
  height?: number;
  hidden?: boolean;
  style?: number;
}

export interface SheetLayout {
  merges: MergeRange[];
  cols: ColLayout[];
  rows: RowLayout[];
  defaultRowHeight: number;
  /** Linhas/colunas congeladas (painel), 0 quando não há. */
  frozenRows: number;
  frozenCols: number;
}

/** Excel mede largura em caracteres; 7px por caractere + 5px de padding. */
export const colWidthToPx = (chars: number): number => Math.round(chars * 7 + 5);

/** Altura vem em pontos; 96dpi / 72pt. */
export const pointsToPx = (points: number): number => Math.round(points * (4 / 3));

const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

const numAttr = (tag: string, name: string): number | undefined => {
  const raw = attr(tag, name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

export function parseMerges(sheetXml: string): MergeRange[] {
  const out: MergeRange[] = [];
  for (const m of sheetXml.matchAll(/<mergeCell\b[^>]*ref="([^"]+)"/g)) {
    const [a, b] = m[1]!.split(':');
    const from = parseCellRef(a ?? '');
    const to = b ? parseCellRef(b) : from;
    if (!from || !to) continue;
    out.push({
      top: Math.min(from.row, to.row),
      left: Math.min(from.col, to.col),
      bottom: Math.max(from.row, to.row),
      right: Math.max(from.col, to.col),
    });
  }
  return out;
}

export function parseCols(sheetXml: string): ColLayout[] {
  const out: ColLayout[] = [];
  for (const m of sheetXml.matchAll(/<col\b[^>]*\/?>/g)) {
    const tag = m[0];
    const min = numAttr(tag, 'min');
    const max = numAttr(tag, 'max');
    if (min === undefined) continue;
    const width = numAttr(tag, 'width');
    const style = numAttr(tag, 'style');
    out.push({
      from: min - 1,
      to: (max ?? min) - 1,
      ...(width !== undefined ? { width: colWidthToPx(width) } : {}),
      ...(attr(tag, 'hidden') === '1' ? { hidden: true } : {}),
      ...(style !== undefined ? { style } : {}),
    });
  }
  return out;
}

export function parseRows(sheetXml: string): RowLayout[] {
  const out: RowLayout[] = [];
  for (const m of sheetXml.matchAll(/<row\b[^>]*?\/?>/g)) {
    const tag = m[0];
    const r = numAttr(tag, 'r');
    if (r === undefined) continue;
    const ht = numAttr(tag, 'ht');
    // `s` só vale como padrão da linha quando customFormat está ligado.
    const style = attr(tag, 'customFormat') === '1' ? numAttr(tag, 's') : undefined;
    const row: RowLayout = { row: r - 1 };
    if (ht !== undefined) row.height = pointsToPx(ht);
    if (attr(tag, 'hidden') === '1') row.hidden = true;
    if (style !== undefined) row.style = style;
    if (row.height !== undefined || row.hidden || row.style !== undefined) out.push(row);
  }
  return out;
}

/** Painel congelado declarado no sheetView. */
export function parseFrozen(sheetXml: string): { frozenRows: number; frozenCols: number } {
  const pane = /<pane\b[^>]*\/?>/.exec(sheetXml)?.[0];
  if (!pane) return { frozenRows: 0, frozenCols: 0 };
  const state = attr(pane, 'state');
  if (state !== 'frozen' && state !== 'frozenSplit') return { frozenRows: 0, frozenCols: 0 };
  return {
    frozenRows: numAttr(pane, 'ySplit') ?? 0,
    frozenCols: numAttr(pane, 'xSplit') ?? 0,
  };
}

export function parseLayout(sheetXml: string): SheetLayout {
  const fmt = /<sheetFormatPr\b[^>]*\/?>/.exec(sheetXml)?.[0];
  const defaultHeight = fmt ? numAttr(fmt, 'defaultRowHeight') : undefined;
  return {
    merges: parseMerges(sheetXml),
    cols: parseCols(sheetXml),
    rows: parseRows(sheetXml),
    defaultRowHeight: pointsToPx(defaultHeight ?? 15),
    ...parseFrozen(sheetXml),
  };
}

/** Célula é o canto superior esquerdo de uma mesclagem? */
export const mergeAt = (merges: MergeRange[], row: number, col: number): MergeRange | undefined =>
  merges.find((m) => m.top === row && m.left === col);

/** Célula é coberta por uma mesclagem sem ser a âncora dela? */
export const coveredBy = (merges: MergeRange[], row: number, col: number): MergeRange | undefined =>
  merges.find((m) => row >= m.top && row <= m.bottom && col >= m.left && col <= m.right
    && !(m.top === row && m.left === col));

/** Estilo padrão da célula quando ela não tem `s` próprio: linha, depois coluna. */
export function defaultStyleFor(layout: SheetLayout, row: number, col: number): number | undefined {
  const rowStyle = layout.rows.find((r) => r.row === row)?.style;
  if (rowStyle !== undefined) return rowStyle;
  return layout.cols.find((c) => col >= c.from && col <= c.to)?.style;
}
