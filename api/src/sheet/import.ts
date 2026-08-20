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
import { parseTheme } from './theme';
import { parseConditionalFormatting, type CfRule } from './conditional';
import { parseLayout, type SheetLayout } from './layout';
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

interface FileFacts {
  /** Índice de estilo por referência A1, por aba. */
  byRef: Map<string, Map<string, number>>;
  /** Estilos resolvidos por índice de cellXfs. */
  resolved: CellStyle[];
  /** Formatos diferenciais usados pela formatação condicional. */
  dxfs: CellStyle[];
  layouts: Map<string, SheetLayout>;
  cf: Map<string, CfRule[]>;
}

/**
 * Tudo que o xlsx guarda fora dos valores: estilos (já com cor de tema
 * resolvida), formatos condicionais e geometria de cada aba.
 */
function readFileFacts(bytes: Uint8Array): FileFacts {
  const files = unzipSync(bytes);
  const dec = new TextDecoder();
  const themeRaw = files['xl/theme/theme1.xml'];
  const palette = parseTheme(themeRaw ? dec.decode(themeRaw) : null);
  const table = stylesOf(files, palette);

  const byRef = new Map<string, Map<string, number>>();
  const layouts = new Map<string, SheetLayout>();
  const cf = new Map<string, CfRule[]>();

  for (const [name, part] of resolveSheetParts(files)) {
    const raw = files[part];
    if (!raw) continue;
    const xml = dec.decode(raw);
    byRef.set(name, readStyleRefs(xml));
    layouts.set(name, parseLayout(xml));
    cf.set(name, parseConditionalFormatting(xml, palette));
  }

  return { byRef, resolved: resolveAll(table), dxfs: table.dxfs, layouts, cf };
}

export const EMPTY_LAYOUT: SheetLayout = {
  merges: [], cols: [], rows: [], defaultRowHeight: 20, frozenRows: 0, frozenCols: 0,
};

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
        // Fórmula da célula (sem o "="); `v` fica sendo o valor em cache.
        if (raw && typeof raw.f === 'string' && raw.f !== '') cell.f = raw.f;
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

  const facts: FileFacts = isZipWorkbook(key)
    ? readFileFacts(bytes)
    : { byRef: new Map(), resolved: [], dxfs: [], layouts: new Map(), cf: new Map() };

  const usedStyles = new Map<string, CellStyle>();
  const sheets = wb.SheetNames.map((name) => {
    const sheet = readSheet(wb.Sheets[name]!, name, facts.byRef.get(name), facts.resolved, usedStyles);
    sheet.layout = facts.layouts.get(name) ?? EMPTY_LAYOUT;
    sheet.cf = facts.cf.get(name) ?? [];
    // Estilo padrão de linha/coluna também precisa viajar: a célula não guarda
    // esse `s`, quem renderiza resolve o fallback.
    for (const style of [...sheet.layout.rows, ...sheet.layout.cols]) {
      if (style.style === undefined) continue;
      const resolvedStyle = facts.resolved[style.style];
      if (resolvedStyle && !isBlankStyle(resolvedStyle)) usedStyles.set(String(style.style), resolvedStyle);
    }
    return sheet;
  });

  const total = sheets.reduce((acc, s) => acc + s.cells.size, 0);
  if (total > MAX_CELLS) throw new Error('planilha_grande');
  return { sheetNames: wb.SheetNames, sheets, styles: usedStyles, dxfs: facts.dxfs };
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
