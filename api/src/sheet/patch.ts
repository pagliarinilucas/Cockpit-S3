// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Patch cirúrgico de xlsx: reescreve apenas a região <sheetData> das abas que
 * mudaram e devolve o zip com TODAS as outras partes (gráficos, tabelas
 * dinâmicas, macros, sharedStrings) com conteúdo idêntico ao original. Células
 * não tocadas são reemitidas com o XML original verbatim, o que preserva
 * fórmula (<f>), estilo (s=) e valor em cache. Mudança só de estilo preserva o
 * conteúdo da célula e troca apenas o atributo `s`. O styles.xml é estendido de
 * forma append-only (ver styles.ts). Nunca devolve zip parcial: em qualquer
 * inconsistência, lança.
 */
import { unzipSync, zipSync } from 'fflate';
import { cellRef, parseCellRef, type CellValue } from './model';
import { StyleWriter, parseStyles, type CellStyle, type StyleTable } from './styles';
import type { ThemePalette } from './theme';

// Data fixa p/ saída determinística; longe das bordas de 1980/2099 do formato zip,
// que são avaliadas no fuso LOCAL (1980-01-01T00:00Z cai em 1979 em fuso negativo).
const ZIP_EPOCH = new Date('1980-06-01T12:00:00Z');

const STYLES_PART = 'xl/styles.xml';
const EMPTY_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
  + '<borders count="1"><border/></borders>'
  + '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
  + '</styleSheet>';

const dec = new TextDecoder();
const enc = new TextEncoder();

/**
 * Alteração de uma célula. `v` ausente = mantém valor e fórmula como estão (só
 * mexe no estilo). `style` ausente = mantém o estilo; `null` = volta ao padrão.
 */
export interface CellPatch {
  v?: CellValue;
  style?: CellStyle | null;
}

/** `cells` é indexado por referência A1 (ex: "B7"). */
export interface SheetPatch {
  name: string;
  cells: Map<string, CellPatch>;
}

interface RawCell {
  ref: string;
  row: number;
  col: number;
  xml: string;
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
    out.set(ref, { ref, row: pos.row, col: pos.col, xml });
  }
  return out;
}

/** Atributos de <row> originais (ht, customHeight...) por índice de linha. */
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

const styleIndexOf = (cellXml: string): number | null => {
  const s = /^<c\b[^>]*?\bs="(\d+)"/.exec(cellXml)?.[1];
  return s === undefined ? null : Number(s);
};

/** Troca (ou insere) o atributo `s` na tag de abertura, sem tocar no conteúdo. */
function withStyleAttr(cellXml: string, styleIndex: number | null): string {
  const open = /^<c\b[^>]*?\/?>/.exec(cellXml);
  if (!open) return cellXml;
  let tag = open[0].replace(/\s*\bs="\d+"/, '');
  if (styleIndex !== null) {
    tag = tag.replace(/^<c\b/, `<c s="${styleIndex}"`);
  }
  return tag + cellXml.slice(open[0].length);
}

function cellXml(ref: string, styleIndex: number | null, value: CellValue): string {
  const s = styleIndex === null ? '' : ` s="${styleIndex}"`;
  if (value === null || value === '') return `<c r="${ref}"${s}/>`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return `<c r="${ref}"${s}/>`;
    return `<c r="${ref}"${s}><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') return `<c r="${ref}"${s} t="b"><v>${value ? 1 : 0}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

/** Uma célula sem valor e sem estilo não precisa existir no arquivo. */
const isEmptyCell = (xml: string) => /^<c\b[^>]*\/>$/.test(xml) && !/\bs="\d+"/.test(xml);

/**
 * Reemite a região sheetData combinando as células originais (verbatim) com as
 * alteradas. `resolveStyle` traduz o estilo pedido em índice de cellXfs.
 */
export function rewriteSheetData(
  sheetXml: string,
  changed: Map<string, CellPatch>,
  resolveStyle: (style: CellStyle) => number = () => 0,
): string {
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

  for (const [ref, patch] of changed) {
    const pos = parseCellRef(ref);
    if (!pos) throw new Error(`ref_invalida:${ref}`);
    const prev = cells.get(ref);

    const styleIndex = patch.style === undefined
      ? (prev ? styleIndexOf(prev.xml) : null)
      : patch.style === null ? null : resolveStyle(patch.style);

    // Só estilo: preserva fórmula, tipo e valor em cache da célula original.
    const xml = patch.v === undefined && prev
      ? withStyleAttr(prev.xml, styleIndex)
      : cellXml(ref, styleIndex, patch.v ?? null);

    if (isEmptyCell(xml)) { cells.delete(ref); continue; }
    cells.set(ref, { ref, row: pos.row, col: pos.col, xml });
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
 * `patches` sai com conteúdo idêntico ao original — exceto styles.xml, que só
 * ganha entradas novas quando algum estilo inédito é usado.
 */
export function patchXlsx(original: Uint8Array, patches: SheetPatch[]): Uint8Array {
  const files = unzipSync(original);
  const parts = resolveSheetParts(files);

  const stylesXml = files[STYLES_PART] ? dec.decode(files[STYLES_PART]!) : EMPTY_STYLES;
  const writer = new StyleWriter(parseStyles(stylesXml));
  const resolveStyle = (style: CellStyle) => writer.ensureXf(style);

  for (const patch of patches) {
    if (!patch.cells.size) continue;
    const part = parts.get(patch.name);
    if (!part) throw new Error(`aba_desconhecida:${patch.name}`);
    const raw = files[part];
    if (!raw) throw new Error(`parte_ausente:${part}`);
    const next = rewriteDimension(rewriteSheetData(dec.decode(raw), patch.cells, resolveStyle));
    files[part] = enc.encode(next);
  }

  if (writer.changed) files[STYLES_PART] = enc.encode(writer.serialize());

  return zipSync(files, { level: 6, mtime: ZIP_EPOCH });
}

/** Tabela de estilos do arquivo — usada na importação para resolver cada `s`. */
export function stylesOf(files: Record<string, Uint8Array>, palette?: ThemePalette): StyleTable {
  const raw = files[STYLES_PART];
  return parseStyles(raw ? dec.decode(raw) : EMPTY_STYLES, palette);
}
