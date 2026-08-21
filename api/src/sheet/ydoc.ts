// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Forma do documento Yjs. O cliente usa exatamente o mesmo layout (ver
 * web/src/sheet/session.ts): um Y.Map por aba com chave R{linha}C{coluna}, um
 * Y.Array com a ordem das abas e um Y.Map de estilos indexado por id.
 */
import * as Y from 'yjs';
import {
  GEOMETRY_PREFIX, SHEET_ORDER, SHEET_PREFIX, STYLES, cellKey,
  clampColWidth, clampRowHeight, colWidthKey, parseGeometryKey, rowHeightKey,
  type Cell, type CellStyle, type CellValue, type WorkbookData,
} from './model';
import { styleKey } from './styles';





export const sheetMap = (doc: Y.Doc, name: string) => doc.getMap<Cell>(SHEET_PREFIX + name);

export const stylesMap = (doc: Y.Doc) => doc.getMap<CellStyle>(STYLES);

export const geometryMap = (doc: Y.Doc, name: string) => doc.getMap<number>(GEOMETRY_PREFIX + name);

export interface SheetGeometry {
  cols: Map<number, number>;
  rows: Map<number, number>;
}

export function geometryOf(doc: Y.Doc, name: string): SheetGeometry {
  const cols = new Map<number, number>();
  const rows = new Map<number, number>();
  for (const [k, px] of geometryMap(doc, name).entries()) {
    const parsed = parseGeometryKey(k);
    if (!parsed || typeof px !== 'number' || !Number.isFinite(px)) continue;
    if (parsed.axis === 'col') cols.set(parsed.index, px);
    else rows.set(parsed.index, px);
  }
  return { cols, rows };
}

export function setColWidth(doc: Y.Doc, name: string, col: number, px: number): void {
  geometryMap(doc, name).set(colWidthKey(col), clampColWidth(px));
}

export function setRowHeight(doc: Y.Doc, name: string, row: number, px: number): void {
  geometryMap(doc, name).set(rowHeightKey(row), clampRowHeight(px));
}

export const sheetNames = (doc: Y.Doc): string[] => doc.getArray<string>(SHEET_ORDER).toArray();

export const styleOf = (doc: Y.Doc, cell: Cell | undefined): CellStyle | undefined =>
  cell?.s === undefined ? undefined : stylesMap(doc).get(cell.s);

/** Carga inicial: uma transação só, para gerar um único update de origem. */
export function applyWorkbook(doc: Y.Doc, wbd: WorkbookData): void {
  doc.transact(() => {
    const order = doc.getArray<string>(SHEET_ORDER);
    if (order.length) order.delete(0, order.length);
    order.insert(0, wbd.sheetNames);

    const styles = stylesMap(doc);
    for (const [id, style] of wbd.styles) styles.set(id, style);

    for (const sheet of wbd.sheets) {
      const map = sheetMap(doc, sheet.name);
      for (const [k, cell] of sheet.cells) map.set(k, cell);
    }
  }, 'import');
}

export function setCell(doc: Y.Doc, sheet: string, row: number, col: number, value: CellValue): void {
  const map = sheetMap(doc, sheet);
  const k = cellKey(row, col);
  const prev = map.get(k);
  if ((value === null || value === '') && prev?.s === undefined) map.delete(k);
  else map.set(k, prev?.s === undefined ? { v: value } : { v: value, s: prev.s });
}

/**
 * Id do estilo com esse visual, criando um se ainda não existir. Um visual novo
 * é gravado SEM `xf`: manter o xf de origem faria o patcher reusar o estilo
 * antigo do arquivo e a mudança do usuário sumiria.
 */
export function ensureStyle(doc: Y.Doc, style: CellStyle): string {
  const styles = stylesMap(doc);
  const wanted = styleKey(style);
  for (const [id, existing] of styles.entries()) {
    if (existing && styleKey(existing) === wanted) return id;
  }
  const { xf: _ignored, ...visual } = style;
  let n = styles.size;
  let id = `n${n}`;
  while (styles.has(id)) id = `n${++n}`;
  styles.set(id, visual);
  return id;
}

/** Aplica (ou remove, com null) o estilo de uma célula, preservando o valor. */
export function setStyle(doc: Y.Doc, sheet: string, row: number, col: number, style: CellStyle | null): void {
  const map = sheetMap(doc, sheet);
  const k = cellKey(row, col);
  const prev = map.get(k);
  const value = prev?.v ?? null;

  // O texto formatado do Excel (`w`) não vale mais depois de mexer no formato:
  // quem renderiza passa a ser o formatador do cliente.
  if (style === null) {
    if (!prev) return;
    if (value === null) map.delete(k);
    else map.set(k, { v: value });
    return;
  }
  map.set(k, { v: value, s: ensureStyle(doc, style) });
}

/** Estilo efetivo de uma célula, pronto para mesclar uma alteração parcial. */
export function styleAt(doc: Y.Doc, sheet: string, row: number, col: number): CellStyle {
  return styleOf(doc, sheetMap(doc, sheet).get(cellKey(row, col))) ?? {};
}

export function cellCount(doc: Y.Doc): number {
  return sheetNames(doc).reduce((acc, name) => acc + sheetMap(doc, name).size, 0);
}
