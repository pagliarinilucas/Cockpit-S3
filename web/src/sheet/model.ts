// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/** Espelha api/src/sheet/model.ts — o layout do doc tem que ser idêntico. */

export type CellValue = string | number | boolean | null;

export interface Cell {
  v: CellValue;
  w?: string;
}

export const SHEET_PREFIX = 'sheet:';
export const SHEET_ORDER = 'sheetNames';

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

/** Texto exibido na célula: o formatado do Excel quando existe. */
export function display(cell: Cell | undefined): string {
  if (!cell) return '';
  if (cell.w) return cell.w;
  if (cell.v === null) return '';
  if (typeof cell.v === 'boolean') return cell.v ? 'VERDADEIRO' : 'FALSO';
  return String(cell.v);
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
