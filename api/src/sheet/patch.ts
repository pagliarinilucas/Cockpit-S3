// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Patch cirúrgico de xlsx: reescreve apenas a região <sheetData> das abas que
 * mudaram e devolve o zip com TODAS as outras partes (gráficos, tabelas
 * dinâmicas, macros, estilos, sharedStrings) com conteúdo idêntico ao original.
 * Células não tocadas são reemitidas com o XML original verbatim, o que preserva
 * fórmula (<f>), estilo (s=) e valor em cache. Nunca devolve zip parcial: em
 * qualquer inconsistência, lança.
 */
import { unzipSync, zipSync } from 'fflate';
import { cellRef, colName, parseCellRef, type CellValue } from './model';

// Data fixa p/ saída determinística; longe das bordas de 1980/2099 do formato zip,
// que são avaliadas no fuso LOCAL (1980-01-01T00:00Z cai em 1979 em fuso negativo).
const ZIP_EPOCH = new Date('1980-06-01T12:00:00Z');

const dec = new TextDecoder();
const enc = new TextEncoder();

/** `cells` é indexado por referência A1 (ex: "B7"); null ou '' apaga a célula. */
export interface SheetPatch {
  name: string;
  cells: Map<string, CellValue>;
}

interface RawCell {
  ref: string;
  row: number;
  col: number;
  xml: string;
  styleAttr: string;
}

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
};

const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]!);

/** Nome da aba -> caminho da parte XML, resolvido por workbook.xml + rels. */
export function resolveSheetParts(files: Record<string, Uint8Array>): Map<string, string> {
  const wbRaw = files['xl/workbook.xml'];
  const relsRaw = files['xl/_rels/workbook.xml.rels'];
  if (!wbRaw || !relsRaw) throw new Error('xlsx_sem_workbook');
  const wb = dec.decode(wbRaw);
  const rels = dec.decode(relsRaw);

  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = m[0];
    const id = /\bId="([^"]+)"/.exec(tag)?.[1];
    const t = /\bTarget="([^"]+)"/.exec(tag)?.[1];
    if (!id || !t) continue;
    const clean = t.replace(/^\/xl\//, '').replace(/^\.\//, '');
    target.set(id, clean.startsWith('xl/') ? clean : `xl/${clean}`);
  }

  const out = new Map<string, string>();
  for (const m of wb.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const tag = m[0];
    const name = /\bname="([^"]*)"/.exec(tag)?.[1];
    const rid = /\br:id="([^"]+)"/.exec(tag)?.[1];
    if (!name || !rid) continue;
    const part = target.get(rid);
    if (part) out.set(unescapeXml(name), part);
  }
  return out;
}

function unescapeXml(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e) =>
    e === 'amp' ? '&' : e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'quot' ? '"' : "'");
}

/** Extrai as células existentes (com o XML cru de cada uma) da região sheetData. */
function readCells(sheetData: string): Map<string, RawCell> {
  const out = new Map<string, RawCell>();
  for (const m of sheetData.matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) {
    const xml = m[0];
    const ref = /\br="([A-Za-z]+\d+)"/.exec(xml)?.[1];
    if (!ref) continue;
    const pos = parseCellRef(ref);
    if (!pos) continue;
    const style = /\bs="(\d+)"/.exec(xml)?.[1];
    out.set(ref, { ref, row: pos.row, col: pos.col, xml, styleAttr: style ? ` s="${style}"` : '' });
  }
  return out;
}

/** Atributos de <row> originais (spans, ht, customHeight...) por índice de linha. */
function readRowAttrs(sheetData: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const m of sheetData.matchAll(/<row\b([^>]*?)\/?>/g)) {
    const attrs = m[1] ?? '';
    const r = /\br="(\d+)"/.exec(attrs)?.[1];
    if (!r) continue;
    out.set(Number(r) - 1, attrs.replace(/\s*\bspans="[^"]*"/, '').trim());
  }
  return out;
}

function cellXml(ref: string, styleAttr: string, value: CellValue): string {
  if (value === null || value === '') return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return `<c r="${ref}"${styleAttr}><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') return `<c r="${ref}"${styleAttr} t="b"><v>${value ? 1 : 0}</v></c>`;
  return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

/**
 * Reemite a região sheetData combinando as células originais (verbatim) com as
 * alteradas. `changed` usa referência A1; valor null/'' apaga a célula.
 */
export function rewriteSheetData(sheetXml: string, changed: Map<string, CellValue>): string {
  const open = /<sheetData\s*\/>|<sheetData\b[^>]*>/.exec(sheetXml);
  if (!open) throw new Error('sheet_sem_sheetData');
  const isEmpty = open[0].endsWith('/>');
  const start = open.index;
  const bodyStart = start + open[0].length;
  const closeAt = isEmpty ? bodyStart : sheetXml.indexOf('</sheetData>', bodyStart);
  if (!isEmpty && closeAt < 0) throw new Error('sheet_sheetData_aberto');
  const bodyEnd = isEmpty ? bodyStart : closeAt;
  const body = sheetXml.slice(bodyStart, bodyEnd);

  const cells = readCells(body);
  const rowAttrs = readRowAttrs(body);

  for (const [ref, value] of changed) {
    const pos = parseCellRef(ref);
    if (!pos) throw new Error(`ref_invalida:${ref}`);
    const prev = cells.get(ref);
    const xml = cellXml(ref, prev?.styleAttr ?? '', value);
    if (!xml) { cells.delete(ref); continue; }
    cells.set(ref, { ref, row: pos.row, col: pos.col, xml, styleAttr: prev?.styleAttr ?? '' });
  }

  const byRow = new Map<number, RawCell[]>();
  for (const c of cells.values()) {
    const list = byRow.get(c.row);
    if (list) list.push(c); else byRow.set(c.row, [c]);
  }

  const rows: string[] = [];
  for (const rowIdx of [...byRow.keys()].sort((a, b) => a - b)) {
    const list = byRow.get(rowIdx)!.sort((a, b) => a.col - b.col);
    const first = list[0]!.col;
    const last = list[list.length - 1]!.col;
    const original = rowAttrs.get(rowIdx);
    const attrs = original && original.length ? original : `r="${rowIdx + 1}"`;
    const spans = `spans="${first + 1}:${last + 1}"`;
    rows.push(`<row ${attrs} ${spans}>${list.map((c) => c.xml).join('')}</row>`);
  }

  const rebuilt = rows.length ? `<sheetData>${rows.join('')}</sheetData>` : '<sheetData/>';
  const tail = isEmpty ? sheetXml.slice(bodyEnd) : sheetXml.slice(closeAt + '</sheetData>'.length);
  return sheetXml.slice(0, start) + rebuilt + tail;
}

/** Atualiza a dimension (<dimension ref="A1:C9"/>) quando ela existe. */
function rewriteDimension(sheetXml: string): string {
  const refs = [...sheetXml.matchAll(/<c\b[^>]*\br="([A-Za-z]+\d+)"/g)]
    .map((m) => parseCellRef(m[1]!))
    .filter((p): p is { row: number; col: number } => !!p);
  if (!refs.length) return sheetXml;
  const maxRow = Math.max(...refs.map((p) => p.row));
  const maxCol = Math.max(...refs.map((p) => p.col));
  const minRow = Math.min(...refs.map((p) => p.row));
  const minCol = Math.min(...refs.map((p) => p.col));
  const ref = `${cellRef(minRow, minCol)}:${cellRef(maxRow, maxCol)}`;
  return sheetXml.replace(/<dimension\b[^>]*\/>/, `<dimension ref="${ref}"/>`);
}

/**
 * Aplica as mudanças e devolve o xlsx completo. Toda parte não listada em
 * `patches` sai com conteúdo idêntico ao original.
 */
export function patchXlsx(original: Uint8Array, patches: SheetPatch[]): Uint8Array {
  const files = unzipSync(original);
  const parts = resolveSheetParts(files);

  for (const patch of patches) {
    if (!patch.cells.size) continue;
    const part = parts.get(patch.name);
    if (!part) throw new Error(`aba_desconhecida:${patch.name}`);
    const raw = files[part];
    if (!raw) throw new Error(`parte_ausente:${part}`);
    const next = rewriteDimension(rewriteSheetData(dec.decode(raw), patch.cells));
    files[part] = enc.encode(next);
  }

  return zipSync(files, { level: 6, mtime: ZIP_EPOCH });
}


