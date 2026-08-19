// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, expect, it } from 'bun:test';
import * as Y from 'yjs';
import * as XLSX from 'xlsx';
import { diffAgainstBase, materialize, type SheetIo } from './materialize';
import { parseWorkbook } from './import';
import { applyWorkbook, setCell } from './ydoc';

function xlsxOf(sheets: Record<string, unknown[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

function docOf(bytes: Uint8Array, key = 'x.xlsx'): Y.Doc {
  const doc = new Y.Doc();
  applyWorkbook(doc, parseWorkbook(bytes, key));
  return doc;
}

/** I/O falso: guarda os bytes em memória e deriva o fingerprint do conteúdo. */
function fakeIo(initial: Uint8Array, key = 'x.xlsx') {
  const state = { bytes: initial, writes: 0, lastUser: '' };
  const io: SheetIo = {
    async fetchBytes() { return state.bytes; },
    async fingerprint() { return `len:${state.bytes.byteLength}:${state.bytes[0] ?? 0}:${state.writes}`; },
    async writeBytes(_b, _k, bytes, user) { state.bytes = bytes; state.writes++; state.lastUser = user; },
  };
  return { io, state, key };
}

const cellOf = (bytes: Uint8Array, sheet: string, ref: string) =>
  XLSX.read(bytes, { type: 'array' }).Sheets[sheet]?.[ref]?.v;

describe('diffAgainstBase', () => {
  it('não acha diferença quando o doc espelha o arquivo', () => {
    const base = xlsxOf({ A: [['a', 1]] });
    expect(diffAgainstBase(docOf(base), base, 'x.xlsx')).toEqual([]);
  });

  it('acha só a célula alterada', () => {
    const base = xlsxOf({ A: [['a', 1]] });
    const doc = docOf(base);
    setCell(doc, 'A', 0, 1, 99);
    const patches = diffAgainstBase(doc, base, 'x.xlsx');
    expect(patches).toHaveLength(1);
    expect([...patches[0]!.cells]).toEqual([['B1', 99]]);
  });

  it('acha célula nova fora do range original', () => {
    const base = xlsxOf({ A: [['a']] });
    const doc = docOf(base);
    setCell(doc, 'A', 4, 2, 'novo');
    expect([...diffAgainstBase(doc, base, 'x.xlsx')[0]!.cells]).toEqual([['C5', 'novo']]);
  });

  it('marca como null a célula apagada no doc', () => {
    const base = xlsxOf({ A: [['a', 'b']] });
    const doc = docOf(base);
    setCell(doc, 'A', 0, 1, null);
    expect([...diffAgainstBase(doc, base, 'x.xlsx')[0]!.cells]).toEqual([['B1', null]]);
  });

  it('separa as mudanças por aba', () => {
    const base = xlsxOf({ Um: [['a']], Dois: [['b']] });
    const doc = docOf(base);
    setCell(doc, 'Um', 0, 0, 'x');
    setCell(doc, 'Dois', 1, 1, 'y');
    const patches = diffAgainstBase(doc, base, 'x.xlsx');
    expect(patches.map((p) => p.name)).toEqual(['Um', 'Dois']);
    expect([...patches[1]!.cells]).toEqual([['B2', 'y']]);
  });
});

describe('materialize', () => {
  it('salva a célula editada e devolve a contagem', async () => {
    const base = xlsxOf({ A: [['a', 1]] });
    const { io, state } = fakeIo(base);
    const doc = docOf(base);
    setCell(doc, 'A', 0, 1, 42);

    const first = await io.fingerprint('c:b', 'x.xlsx');
    const res = await materialize({ doc, bucketId: 'c:b', key: 'x.xlsx', user: 'ana', expectedFingerprint: first, io });

    expect(res.status).toBe('saved');
    expect(res.status === 'saved' && res.changed).toBe(1);
    expect(state.writes).toBe(1);
    expect(cellOf(state.bytes, 'A', 'B1')).toBe(42);
  });

  it('não escreve quando nada mudou', async () => {
    const base = xlsxOf({ A: [['a']] });
    const { io, state } = fakeIo(base);
    const fp = await io.fingerprint('c:b', 'x.xlsx');
    const res = await materialize({ doc: docOf(base), bucketId: 'c:b', key: 'x.xlsx', user: 'ana', expectedFingerprint: fp, io });
    expect(res.status).toBe('unchanged');
    expect(state.writes).toBe(0);
  });

  it('recusa e não escreve quando o arquivo mudou fora do editor', async () => {
    const base = xlsxOf({ A: [['a']] });
    const { io, state } = fakeIo(base);
    const doc = docOf(base);
    setCell(doc, 'A', 0, 0, 'meu');

    const res = await materialize({
      doc, bucketId: 'c:b', key: 'x.xlsx', user: 'ana',
      expectedFingerprint: 'fingerprint-de-outra-versao', io,
    });

    expect(res.status).toBe('diverged');
    expect(state.writes).toBe(0);
    expect(cellOf(state.bytes, 'A', 'A1')).toBe('a');
  });

  it('devolve o fingerprint novo, que permite salvar de novo em seguida', async () => {
    const base = xlsxOf({ A: [['a']] });
    const { io } = fakeIo(base);
    const doc = docOf(base);

    setCell(doc, 'A', 0, 0, 'um');
    const r1 = await materialize({ doc, bucketId: 'c:b', key: 'x.xlsx', user: 'ana', expectedFingerprint: await io.fingerprint('c:b', 'x.xlsx'), io });
    expect(r1.status).toBe('saved');

    setCell(doc, 'A', 1, 0, 'dois');
    const r2 = await materialize({
      doc, bucketId: 'c:b', key: 'x.xlsx', user: 'ana',
      expectedFingerprint: r1.status === 'saved' ? r1.fingerprint : null, io,
    });
    expect(r2.status).toBe('saved');
  });

  it('preserva partes exóticas do arquivo entre materializações', async () => {
    const base = xlsxOf({ A: [['a', 1]] });
    const { io, state } = fakeIo(base);
    const doc = docOf(base);
    setCell(doc, 'A', 0, 0, 'editado');
    await materialize({ doc, bucketId: 'c:b', key: 'x.xlsx', user: 'ana', expectedFingerprint: await io.fingerprint('c:b', 'x.xlsx'), io });

    const wb = XLSX.read(state.bytes, { type: 'array' });
    expect(wb.SheetNames).toEqual(['A']);
    expect(wb.Sheets['A']!['A1']!.v).toBe('editado');
    expect(wb.Sheets['A']!['B1']!.v).toBe(1);
  });

  it('materializa csv reescrevendo o arquivo inteiro', async () => {
    const base = new TextEncoder().encode('a,b\n1,2\n');
    const { io, state } = fakeIo(base, 'x.csv');
    const doc = docOf(base, 'x.csv');
    setCell(doc, 'Sheet1', 1, 1, 9);

    const res = await materialize({ doc, bucketId: 'c:b', key: 'x.csv', user: 'ana', expectedFingerprint: await io.fingerprint('c:b', 'x.csv'), io });
    expect(res.status).toBe('saved');
    expect(new TextDecoder().decode(state.bytes)).toBe('a,b\n1,9\n');
  });

  it('registra o autor da escrita', async () => {
    const base = xlsxOf({ A: [['a']] });
    const { io, state } = fakeIo(base);
    const doc = docOf(base);
    setCell(doc, 'A', 0, 0, 'z');
    await materialize({ doc, bucketId: 'c:b', key: 'x.xlsx', user: 'bia', expectedFingerprint: await io.fingerprint('c:b', 'x.xlsx'), io });
    expect(state.lastUser).toBe('bia');
  });
});
