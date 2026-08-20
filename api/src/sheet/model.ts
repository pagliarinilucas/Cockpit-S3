// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/** Modelo compartilhado do documento de planilha (mesmo formato no cliente). */
import { createHash } from 'node:crypto';
import type { CellStyle } from './styles';

export type CellValue = string | number | boolean | null;

export type { CellStyle };

/**
 * Valor cru, texto formatado que o Excel exibiria (datas, moeda) e o id do
 * estilo. O estilo é referenciado por id, não embutido: uma linha inteira
 * pintada da mesma cor compartilha uma entrada só.
 */
export interface Cell {
  v: CellValue;
  w?: string;
  s?: string;
}

export interface SheetData {
  name: string;
  rows: number;
  cols: number;
  cells: Map<string, Cell>;
}

export interface WorkbookData {
  sheetNames: string[];
  sheets: SheetData[];
  /** Id do estilo -> estilo resolvido. Só os que alguma célula usa. */
  styles: Map<string, CellStyle>;
}

export const MAX_CELLS = 300_000;
export const MAX_BYTES = 25 * 1024 * 1024;

export const cellKey = (row: number, col: number) => `R${row}C${col}`;

export function parseCellKey(k: string): { row: number; col: number } | null {
  const m = /^R(\d+)C(\d+)$/.exec(k);
  return m ? { row: Number(m[1]), col: Number(m[2]) } : null;
}

/** Índice de coluna (0-based) para letra do Excel: 0 -> A, 26 -> AA. */
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

export function colIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Referência A1 (1-based na linha) a partir dos índices 0-based do modelo. */
export const cellRef = (row: number, col: number) => `${colName(col)}${row + 1}`;

export function parseCellRef(ref: string): { row: number; col: number } | null {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref);
  return m ? { row: Number(m[2]) - 1, col: colIndex(m[1]!) } : null;
}

/** Id estável do documento vivo. Muda se o arquivo for movido/renomeado. */
export const docIdFor = (bucketId: string, key: string): string =>
  createHash('sha256').update(bucketId + '\u0000' + key).digest('hex');

export const SHEET_EXTS = new Set(['xlsx', 'xlsm', 'csv', 'tsv']);

export function isSheetKey(key: string): boolean {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return SHEET_EXTS.has(ext);
}

/** Só xlsx/xlsm têm partes a preservar; csv/tsv são reescritos por inteiro. */
export function isZipWorkbook(key: string): boolean {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return ext === 'xlsx' || ext === 'xlsm';
}
