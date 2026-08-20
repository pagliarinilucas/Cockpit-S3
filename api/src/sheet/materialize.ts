// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Escreve o documento vivo de volta no arquivo do S3. Duas garantias:
 * 1. o que mudou é calculado por diferença contra o arquivo atual, então nada
 *    além das células editadas é reescrito (o patcher preserva o resto);
 * 2. se o arquivo mudou fora do editor desde a abertura, NÃO sobrescreve.
 * O I/O entra por injeção (`SheetIo`) para manter isso testável sem S3.
 */
import type * as Y from 'yjs';
import { extOf, parseWorkbook, serializeDelimited } from './import';
import { patchXlsx, type CellPatch, type SheetPatch } from './patch';
import { sheetMap, sheetNames, stylesMap } from './ydoc';
import { cellRef, isZipWorkbook, parseCellKey, type Cell, type CellStyle, type CellValue } from './model';
import { styleKey } from './styles';

export interface SheetIo {
  /** Bytes atuais do objeto (decifrados, se for bucket cifrado). */
  fetchBytes(bucketId: string, key: string): Promise<Uint8Array>;
  /** Identidade do conteúdo atual no S3 (ETag ou equivalente); null se ausente. */
  fingerprint(bucketId: string, key: string): Promise<string | null>;
  writeBytes(bucketId: string, key: string, bytes: Uint8Array, user: string): Promise<void>;
}

export type MaterializeResult =
  | { status: 'saved'; fingerprint: string | null; changed: number }
  | { status: 'unchanged' }
  | { status: 'diverged'; expected: string | null; actual: string | null };

const same = (a: CellValue, b: CellValue) => (a ?? null) === (b ?? null);

/** Referência A1 a partir da chave R{linha}C{coluna} do modelo. */
function refOfKey(k: string): string | null {
  const pos = parseCellKey(k);
  return pos ? cellRef(pos.row, pos.col) : null;
}

/**
 * Células do doc que diferem do arquivo base, por aba, indexadas por A1. Valor e
 * estilo são comparados separadamente: mudar só a cor gera patch só de estilo,
 * que preserva a fórmula da célula no arquivo.
 */
export function diffAgainstBase(doc: Y.Doc, base: Uint8Array, key: string): SheetPatch[] {
  const parsed = parseWorkbook(base, key);
  const styles = stylesMap(doc);
  const patches: SheetPatch[] = [];

  for (const name of sheetNames(doc)) {
    const baseSheet = parsed.sheets.find((s) => s.name === name);
    const baseCells = baseSheet?.cells ?? new Map<string, Cell>();
    const live = sheetMap(doc, name);
    const cells = new Map<string, CellPatch>();

    // Y.Map e Map nativo não compartilham tipo; a busca entra como função.
    const styleFor = (cell: Cell | undefined, get: (id: string) => CellStyle | undefined): CellStyle | null =>
      cell?.s ? get(cell.s) ?? null : null;

    for (const [k, cell] of live.entries()) {
      const ref = refOfKey(k);
      if (!ref || !cell) continue;
      const before = baseCells.get(k);
      const patch: CellPatch = {};

      if (!same(before?.v ?? null, cell.v ?? null)) patch.v = cell.v ?? null;

      const liveStyle = styleFor(cell, (id) => styles.get(id));
      const baseStyle = styleFor(before, (id) => parsed.styles.get(id));
      if (styleKey(liveStyle ?? {}) !== styleKey(baseStyle ?? {})) patch.style = liveStyle;

      if (patch.v !== undefined || patch.style !== undefined) cells.set(ref, patch);
    }

    for (const k of baseCells.keys()) {
      if (live.has(k)) continue;
      const ref = refOfKey(k);
      if (ref) cells.set(ref, { v: null, style: null });
    }

    if (cells.size) patches.push({ name, cells });
  }
  return patches;
}

/** Todas as células de uma aba — csv/tsv é reescrito inteiro, não por diff. */
function liveCells(doc: Y.Doc, name: string): Map<string, Cell> {
  const out = new Map<string, Cell>();
  for (const [k, cell] of sheetMap(doc, name).entries()) out.set(k, { v: cell?.v ?? null });
  return out;
}

/**
 * Materializa o doc. `expectedFingerprint` é o estado do arquivo quando a sessão
 * abriu (ou a última materialização); divergência aborta sem escrever.
 */
export async function materialize(a: {
  doc: Y.Doc;
  bucketId: string;
  key: string;
  user: string;
  expectedFingerprint: string | null;
  io: SheetIo;
}): Promise<MaterializeResult> {
  const actual = await a.io.fingerprint(a.bucketId, a.key);
  if ((actual ?? null) !== (a.expectedFingerprint ?? null)) {
    return { status: 'diverged', expected: a.expectedFingerprint, actual };
  }

  const base = await a.io.fetchBytes(a.bucketId, a.key);
  const patches = diffAgainstBase(a.doc, base, a.key);
  const changed = patches.reduce((acc, p) => acc + p.cells.size, 0);
  if (!changed) return { status: 'unchanged' };

  const first = sheetNames(a.doc)[0] ?? patches[0]!.name;
  const bytes = isZipWorkbook(a.key)
    ? patchXlsx(base, patches)
    : serializeDelimited({ name: first, rows: 0, cols: 0, cells: liveCells(a.doc, first) }, extOf(a.key));

  await a.io.writeBytes(a.bucketId, a.key, bytes, a.user);
  return { status: 'saved', fingerprint: await a.io.fingerprint(a.bucketId, a.key), changed };
}
