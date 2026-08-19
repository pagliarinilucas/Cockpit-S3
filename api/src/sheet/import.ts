// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Leitura de planilha para o modelo do documento vivo. Guarda o valor cru e o
 * texto formatado (`w`) que o Excel exibiria — sem isso, datas e moedas
 * apareceriam como número de série. Escrita de volta usa só o valor cru.
 */
import * as XLSX from 'xlsx';
import { MAX_CELLS, cellKey, type Cell, type CellValue, type SheetData, type WorkbookData } from './model';

const CSV_EXTS = new Set(['csv', 'tsv']);

export const extOf = (key: string) => key.split('.').pop()?.toLowerCase() ?? '';

function normalize(raw: unknown): CellValue {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'string') return raw;
  if (raw instanceof Date) return raw.toISOString();
  return String(raw);
}

function readSheet(ws: XLSX.WorkSheet, name: string): SheetData {
  const cells = new Map<string, Cell>();
  const ref = ws['!ref'];
  let rows = 0;
  let cols = 0;
  if (ref) {
    const range = XLSX.utils.decode_range(ref);
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const raw = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
        if (!raw) continue;
        const v = normalize(raw.v);
        if (v === null) continue;
        const w = typeof raw.w === 'string' && raw.w !== String(v) ? raw.w : undefined;
        cells.set(cellKey(r, c), w ? { v, w } : { v });
        rows = Math.max(rows, r + 1);
        cols = Math.max(cols, c + 1);
      }
    }
  }
  return { name, rows, cols, cells };
}

/** Lança `planilha_grande` acima do teto — o doc vivo mora na memória do processo. */
export function parseWorkbook(bytes: Uint8Array, key: string): WorkbookData {
  const ext = extOf(key);
  const wb = CSV_EXTS.has(ext)
    ? XLSX.read(new TextDecoder().decode(bytes), { type: 'string', FS: ext === 'tsv' ? '\t' : ',', cellNF: true, cellText: true })
    : XLSX.read(bytes, { type: 'array', cellNF: true, cellText: true });

  const sheets = wb.SheetNames.map((name) => readSheet(wb.Sheets[name]!, name));
  const total = sheets.reduce((acc, s) => acc + s.cells.size, 0);
  if (total > MAX_CELLS) throw new Error('planilha_grande');
  return { sheetNames: wb.SheetNames, sheets };
}

/** Bytes de uma planilha nova e vazia — usado pelo "Nova planilha". */
export function newWorkbookBytes(sheetName = 'Planilha1'): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), sheetName);
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

/** Serializa uma aba como csv/tsv — csv não tem partes a preservar, é reescrito inteiro. */
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
