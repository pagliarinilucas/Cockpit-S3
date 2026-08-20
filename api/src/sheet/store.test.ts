// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, it, expect, beforeAll } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { bootTestEnv } from './test-env';

let sheetStore: typeof import('./store').sheetStore;
let sqlite: typeof import('../db').sqlite;

beforeAll(async () => {
  await bootTestEnv();
  ({ sqlite } = await import('../db'));
  ({ sheetStore } = await import('./store'));
});

const bytes = (...n: number[]) => new Uint8Array(n);

function newDoc(snapshot = bytes(1, 2, 3)) {
  const docId = randomUUID().replace(/-/g, '');
  sheetStore.create({ docId, bucketId: 'c:b', key: 'planilhas/x.xlsx', fingerprint: 'etag-1', snapshot });
  return docId;
}

describe('sheetStore', () => {
  it('cria e recupera o doc', () => {
    const docId = newDoc();
    const row = sheetStore.find(docId)!;
    expect(row.bucketId).toBe('c:b');
    expect(row.key).toBe('planilhas/x.xlsx');
    expect(row.fingerprint).toBe('etag-1');
    expect(row.dirty).toBe(0);
  });

  it('load devolve o snapshot decifrado', () => {
    const docId = newDoc(bytes(9, 8, 7));
    const loaded = sheetStore.load(docId)!;
    expect([...loaded.updates[0]!]).toEqual([9, 8, 7]);
    expect(loaded.seq).toBe(0);
  });

  it('grava o estado cifrado no banco (não em claro)', () => {
    const docId = newDoc(bytes(65, 66, 67, 68));
    const raw = sqlite
      .query('SELECT snapshot FROM sheet_docs WHERE doc_id = ?')
      .get(docId) as { snapshot: Uint8Array };
    const stored = Buffer.from(raw.snapshot);
    expect(stored.includes(Buffer.from([65, 66, 67, 68]))).toBe(false);
    expect(stored.length).toBeGreaterThan(4);
  });

  it('append devolve seq crescente e marca sujo', () => {
    const docId = newDoc();
    expect(sheetStore.append(docId, bytes(10), 'ana')).toBe(1);
    expect(sheetStore.append(docId, bytes(11), 'ana')).toBe(2);
    expect(sheetStore.find(docId)!.dirty).toBe(1);
  });

  it('load devolve snapshot + updates em ordem', () => {
    const docId = newDoc(bytes(1));
    sheetStore.append(docId, bytes(2), 'ana');
    sheetStore.append(docId, bytes(3), 'bia');
    const loaded = sheetStore.load(docId)!;
    expect(loaded.updates.map((u) => [...u])).toEqual([[1], [2], [3]]);
    expect(loaded.seq).toBe(2);
  });

  it('compact substitui o snapshot e descarta updates incorporados', () => {
    const docId = newDoc(bytes(1));
    sheetStore.append(docId, bytes(2), 'ana');
    sheetStore.append(docId, bytes(3), 'ana');
    sheetStore.compact(docId, bytes(4, 4), 2);
    expect(sheetStore.countUpdates(docId)).toBe(0);
    const loaded = sheetStore.load(docId)!;
    expect(loaded.updates.map((u) => [...u])).toEqual([[4, 4]]);
    expect(loaded.seq).toBe(2);
  });

  it('compact preserva updates posteriores ao seq compactado', () => {
    const docId = newDoc(bytes(1));
    sheetStore.append(docId, bytes(2), 'ana');
    sheetStore.append(docId, bytes(3), 'ana');
    sheetStore.compact(docId, bytes(9), 1);
    const loaded = sheetStore.load(docId)!;
    expect(loaded.updates.map((u) => [...u])).toEqual([[9], [3]]);
    expect(loaded.seq).toBe(2);
  });

  it('authorsSince lista autores distintos', () => {
    const docId = newDoc();
    sheetStore.append(docId, bytes(1), 'ana');
    sheetStore.append(docId, bytes(2), 'bia');
    sheetStore.append(docId, bytes(3), 'ana');
    expect(sheetStore.authorsSince(docId, 0).sort()).toEqual(['ana', 'bia']);
  });

  it('markClean zera o sujo e atualiza o fingerprint', () => {
    const docId = newDoc();
    sheetStore.append(docId, bytes(1), 'ana');
    sheetStore.markClean(docId, 'etag-2');
    const row = sheetStore.find(docId)!;
    expect(row.dirty).toBe(0);
    expect(row.fingerprint).toBe('etag-2');
  });

  it('remove apaga doc e updates', () => {
    const docId = newDoc();
    sheetStore.append(docId, bytes(1), 'ana');
    sheetStore.remove(docId);
    expect(sheetStore.find(docId)).toBeNull();
    expect(sheetStore.countUpdates(docId)).toBe(0);
  });

  it('load de doc inexistente devolve null', () => {
    expect(sheetStore.load('nao-existe')).toBeNull();
  });

  it('create é idempotente (segunda abertura não sobrescreve o estado)', () => {
    const docId = newDoc(bytes(1));
    sheetStore.append(docId, bytes(2), 'ana');
    sheetStore.create({ docId, bucketId: 'c:b', key: 'planilhas/x.xlsx', fingerprint: 'etag-9', snapshot: bytes(7) });
    const loaded = sheetStore.load(docId)!;
    expect(loaded.updates.map((u) => [...u])).toEqual([[1], [2]]);
  });

  it('blob cifrado é amarrado ao docId (AD) — outro doc não decifra', () => {
    const a = newDoc(bytes(5, 5, 5));
    const raw = sqlite
      .query('SELECT snapshot, dek_wrapped, kek_version FROM sheet_docs WHERE doc_id = ?')
      .get(a) as { snapshot: Uint8Array; dek_wrapped: Uint8Array; kek_version: number };
    const b = newDoc(bytes(6));
    sqlite.query('UPDATE sheet_docs SET snapshot = ?, dek_wrapped = ?, kek_version = ? WHERE doc_id = ?')
      .run(raw.snapshot, raw.dek_wrapped, raw.kek_version, b);

    expect(() => sheetStore.load(b)).toThrow();
  });
});
