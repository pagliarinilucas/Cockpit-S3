// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/** Espelha api/src/sheet/model.ts — o layout do doc tem que ser idêntico. */
import { formatValue } from './format';

export type CellValue = string | number | boolean | null;

/** Mesmo formato de api/src/sheet/styles.ts. */
export interface CellStyle {
  /** Índice do xf original; presente só em estilo que veio do arquivo. */
  xf?: number;
  bg?: string;
  fg?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: 'left' | 'center' | 'right';
  numFmt?: string;
  border?: boolean;
}

export interface Cell {
  v: CellValue;
  w?: string;
  s?: string;
}

export const SHEET_PREFIX = 'sheet:';
export const SHEET_ORDER = 'sheetNames';
export const STYLES = 'styles';

/** Dois estilos com o mesmo visual são o mesmo estilo (o `xf` não conta). */
export function styleKey(style: CellStyle): string {
  return JSON.stringify([
    style.bg ?? '', style.fg ?? '', !!style.bold, !!style.italic,
    !!style.underline, style.align ?? '', style.numFmt ?? '', !!style.border,
  ]);
}

/**
 * Aplica uma alteração parcial sobre o estilo atual. O `xf` é descartado: o
 * visual resultante é novo e não corresponde mais ao estilo do arquivo.
 * Propriedade com `undefined` na alteração é removida (é como se desliga negrito).
 */
export function mergeStyle(current: CellStyle, change: Partial<CellStyle>): CellStyle {
  const { xf: _drop, ...base } = current;
  const next: CellStyle = { ...base };
  for (const [k, v] of Object.entries(change) as [keyof CellStyle, unknown][]) {
    if (v === undefined || v === false || v === '') delete next[k];
    else Object.assign(next, { [k]: v });
  }
  return next;
}

/** Estilo vazio (sem nada aplicado) não precisa existir. */
export const isBlankStyle = (style: CellStyle): boolean => styleKey(style) === styleKey({});

export const cellKey = (row: number, col: number) => `R${row}C${col}`;

export function parseCellKey(k: string): { row: number; col: number } | null {
  const m = /^R(\d+)C(\d+)$/.exec(k);
  return m ? { row: Number(m[1]), col: Number(m[2]) } : null;
}

export function colName(col: number): string {
  let n = col + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export const cellRef = (row: number, col: number) => `${colName(col)}${row + 1}`;

/**
 * O que o usuário digitou vira número quando é número, na convenção pt-BR:
 * vírgula é decimal e ponto em grupos de 3 é milhar ("1.500" é mil e quinhentos,
 * não 1,5). Ponto isolado com 1 ou 2 casas continua sendo decimal, que é o que
 * quem cola dado em formato internacional espera.
 */
export function coerce(text: string): CellValue {
  const t = text.trim();
  if (t === '') return null;
  if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''));
  if (/^-?\d{1,3}(\.\d{3})*,\d+$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
  if (/^-?\d+,\d+$/.test(t)) return Number(t.replace(',', '.'));
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^-?\d+(\.\d+)?e[+-]?\d+$/i.test(t)) return Number(t);
  const upper = t.toUpperCase();
  if (upper === 'VERDADEIRO' || upper === 'TRUE') return true;
  if (upper === 'FALSO' || upper === 'FALSE') return false;
  return text;
}

/**
 * Texto exibido na célula. Prioridade para o `w` que o próprio Excel calculou —
 * é mais fiel que o nosso formatador; quando a formatação foi feita aqui (o `w`
 * é descartado nesse momento), formata pelo código do estilo.
 */
export function display(cell: Cell | undefined, style?: CellStyle): string {
  if (!cell) return '';
  if (cell.w) return cell.w;
  return formatValue(cell.v, style?.numFmt);
}

/** Texto que aparece ao editar: sempre o valor cru, nunca o formatado. */
export function editText(cell: Cell | undefined): string {
  if (!cell || cell.v === null) return '';
  if (typeof cell.v === 'boolean') return cell.v ? 'VERDADEIRO' : 'FALSO';
  return String(cell.v);
}

export const isSheetName = (name: string): boolean => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return ext === 'xlsx' || ext === 'xlsm' || ext === 'csv' || ext === 'tsv';
};
