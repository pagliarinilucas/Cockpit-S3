// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Forma do documento Yjs. O cliente usa exatamente o mesmo layout (ver
 * web/src/sheet/ydoc.ts): um Y.Map por aba, chave R{linha}C{coluna}, e um
 * Y.Array com a ordem das abas.
 */
import * as Y from 'yjs';
import { cellKey, type Cell, type CellValue, type WorkbookData } from './model';

export const SHEET_PREFIX = 'sheet:';
export const SHEET_ORDER = 'sheetNames';

export const sheetMap = (doc: Y.Doc, name: string) => doc.getMap<Cell>(SHEET_PREFIX + name);

export const sheetNames = (doc: Y.Doc): string[] => doc.getArray<string>(SHEET_ORDER).toArray();

/** Carga inicial: uma transação só, para gerar um único update de origem. */
export function applyWorkbook(doc: Y.Doc, wbd: WorkbookData): void {
  doc.transact(() => {
    const order = doc.getArray<string>(SHEET_ORDER);
    if (order.length) order.delete(0, order.length);
    order.insert(0, wbd.sheetNames);
    for (const sheet of wbd.sheets) {
      const map = sheetMap(doc, sheet.name);
      for (const [k, cell] of sheet.cells) map.set(k, cell);
    }
  }, 'import');
}

export function setCell(doc: Y.Doc, sheet: string, row: number, col: number, value: CellValue): void {
  const map = sheetMap(doc, sheet);
  const k = cellKey(row, col);
  if (value === null || value === '') map.delete(k);
  else map.set(k, { v: value });
}

export function cellCount(doc: Y.Doc): number {
  return sheetNames(doc).reduce((acc, name) => acc + sheetMap(doc, name).size, 0);
}
