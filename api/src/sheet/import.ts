// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Leitura de planilha para o modelo do documento vivo. Valores e texto formatado
 * vêm do SheetJS; o estilo de cada célula vem de uma passada própria no XML da
 * aba (o índice `s`), resolvido contra o styles.xml — é assim que o editor
 * consegue pintar a tela igual ao arquivo. Só os estilos realmente usados vão
 * para o documento, para não inflar o estado com centenas de xf sem uso.
 */
import { unzipSync } from 'fflate';
import * as XLSX from 'xlsx';
import { stylesOf, resolveSheetParts } from './patch';
import { resolveAll, styleKey, type CellStyle } from './styles';
import { MAX_CELLS, cellKey, type Cell, type CellValue, type SheetData, type WorkbookData } from './model';
import { isZipWorkbook } from './model';

const CSV_EXTS = new Set(['csv', 'tsv']);

export const extOf = (key: string) => key.split('.').pop()?.toLowerCase() ?? '';

function normalize(raw: unknown): CellValue {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'string') return raw;
  if (raw instanceof Date) return raw.toISOString();
  return String(raw);
}

const isBlankStyle = (s: CellStyle): boolean => styleKey(s) === styleKey({});

/** Índice de estilo (`s`) de cada célula da aba, por referência A1. */
function readStyleRefs(sheetXml: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of sheetXml.matchAll(/<c\b[^>]*>/g)) {
    const tag = m[0];
    const ref = /\br="([A-Za-z]+\d+)"/.exec(tag)?.[1];
    const s = /\bs="(\d+)"/.exec(tag)?.[1];
    if (ref && s !== undefined) out.set(ref, Number(s));
  }
  return out;
}

/** Estilos por aba, prontos para casar com as células lidas pelo SheetJS. */
function readStyles(bytes: Uint8Array): { byRef: Map<string, Map<string, number>>; resolved: CellStyle[] } {
  const files = unzipSync(bytes);
  const resolved = resolveAll(stylesOf(files));
  const byRef = new Map<string, Map<string, number>>();
  const dec = new TextDecoder();
  for (const [name, part] of resolveSheetParts(files)) {
    const raw = files[part];
    if (raw) byRef.set(name, readStyleRefs(dec.decode(raw)));
  }
  return { byRef, resolved };
}

function readSheet(
  ws: XLSX.WorkSheet,
  name: string,
  styleRefs: Map<string, number> | undefined,
  resolved: CellStyle[],
  usedStyles: Map<string, CellStyle>,
): SheetData {
  const cells = new Map<string, Cell>();
  const ref = ws['!ref'];
  let rows = 0;
  let cols = 0;

  const noteStyle = (addr: string): string | undefined => {
    const xf = styleRefs?.get(addr);
    if (xf === undefined) return undefined;
    const style = resolved[xf];
    if (!style || isBlankStyle(style)) return undefined;
    const id = String(xf);
    usedStyles.set(id, style);
    return id;
  };

  if (ref) {
    const range = XLSX.utils.decode_range(ref);
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const raw = ws[addr] as XLSX.CellObject | undefined;
        const styleId = noteStyle(addr);
        const v = normalize(raw?.v);
        if (v === null && !styleId) continue;

        const w = raw && typeof raw.w === 'string' && raw.w !== String(v) ? raw.w : undefined;
        const cell: Cell = { v };
        if (w) cell.w = w;
        if (styleId) cell.s = styleId;
        cells.set(cellKey(r, c), cell);
        rows = Math.max(rows, r + 1);
        cols = Math.max(cols, c + 1);
      }
    }
  }

  // Célula pintada fora do range declarado ainda precisa aparecer (linha colorida
  // em branco não entra no !ref do SheetJS).
  for (const [addr, xf] of styleRefs ?? []) {
    if (cells.has(addrToKey(addr))) continue;
    const style = resolved[xf];
    if (!style || isBlankStyle(style)) continue;
    const pos = XLSX.utils.decode_cell(addr);
    usedStyles.set(String(xf), style);
    cells.set(cellKey(pos.r, pos.c), { v: null, s: String(xf) });
    rows = Math.max(rows, pos.r + 1);
    cols = Math.max(cols, pos.c + 1);
  }

  return { name, rows, cols, cells };
}

const addrToKey = (addr: string): string => {
  const pos = XLSX.utils.decode_cell(addr);
  return cellKey(pos.r, pos.c);
};

/** Lança `planilha_grande` acima do teto — o doc vivo mora na memória do processo. */
export function parseWorkbook(bytes: Uint8Array, key: string): WorkbookData {
  const ext = extOf(key);
  const isCsv = CSV_EXTS.has(ext);
  const wb = isCsv
    ? XLSX.read(new TextDecoder().decode(bytes), { type: 'string', FS: ext === 'tsv' ? '\t' : ',', cellNF: true, cellText: true })
    : XLSX.read(bytes, { type: 'array', cellNF: true, cellText: true });

  const { byRef, resolved } = isZipWorkbook(key)
    ? readStyles(bytes)
    : { byRef: new Map<string, Map<string, number>>(), resolved: [] as CellStyle[] };

  const usedStyles = new Map<string, CellStyle>();
  const sheets = wb.SheetNames.map((name) =>
    readSheet(wb.Sheets[name]!, name, byRef.get(name), resolved, usedStyles));

  const total = sheets.reduce((acc, s) => acc + s.cells.size, 0);
  if (total > MAX_CELLS) throw new Error('planilha_grande');
  return { sheetNames: wb.SheetNames, sheets, styles: usedStyles };
}

/** Bytes de uma planilha nova e vazia — usado pelo "Nova planilha". */
export function newWorkbookBytes(sheetName = 'Planilha1'): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), sheetName);
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

/** Serializa uma aba como csv/tsv — csv não tem partes a preservar nem estilo. */
export function serializeDelimited(sheet: SheetData, ext: string): Uint8Array {
  const rows: string[][] = [];
  for (const [k, cell] of sheet.cells) {
    const m = /^R(\d+)C(\d+)$/.exec(k);
    if (!m) continue;
    const r = Number(m[1]);
    const c = Number(m[2]);
    (rows[r] ??= [])[c] = cell.v === null ? '' : String(cell.v);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => [...(r ?? [])].map((v) => v ?? '')));
  const text = XLSX.utils.sheet_to_csv(ws, { FS: ext === 'tsv' ? '\t' : ',' });
  return new TextEncoder().encode(text.endsWith('\n') ? text : text + '\n');
}
