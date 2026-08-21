// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Instalação sem criptografia configurada: o editor tem que funcionar, porque o
 * arquivo já está em texto claro no bucket e cifrar só o rascunho não protegia
 * nada. O que NÃO pode é abrir arquivo cifrado sem a chave.
 */
import { describe, it, expect, beforeAll, afterEach } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { bootTestEnv } from './test-env';

let sheetStore: typeof import('./store').sheetStore;
let PLAINTEXT_KEK_VERSION: number;
let kek: typeof import('../crypto/kek');
let guard: typeof import('./guard');
let objects: typeof import('../objects/store');
let sqlite: typeof import('../db').sqlite;

beforeAll(async () => {
  await bootTestEnv();
  ({ sqlite } = await import('../db'));
  ({ sheetStore, PLAINTEXT_KEK_VERSION } = await import('./store'));
  kek = await import('../crypto/kek');
  guard = await import('./guard');
  objects = await import('../objects/store');
});

afterEach(() => {
  if (!kek.getKekProvider()) kek.initFileKekProvider();
});

const withoutKek = <T>(run: () => T): T => {
  kek.forgetKekProvider();
  try { return run(); } finally { kek.initFileKekProvider(); }
};

const bytes = (...n: number[]) => new Uint8Array(n);
const newId = () => randomUUID().replace(/-/g, '');

const snapshotOf = (docId: string): Uint8Array => {
  const row = sqlite.query('select snapshot from sheet_docs where doc_id = ?').get(docId) as
    { snapshot: Uint8Array };
  return new Uint8Array(row.snapshot);
};

const kekVersionOf = (docId: string): number => {
  const row = sqlite.query('select kek_version from sheet_docs where doc_id = ?').get(docId) as { kek_version: number };
  return row.kek_version;
};

describe('rascunho sem KEK', () => {
  it('cria, grava e relê o documento', () => {
    const docId = newId();
    withoutKek(() => {
      sheetStore.create({ docId, bucketId: 'c:b', key: 'x.xlsx', fingerprint: 'etag', snapshot: bytes(1, 2, 3) });
      sheetStore.append(docId, bytes(4, 5), 'ana');
      const loaded = sheetStore.load(docId)!;
      expect([...loaded.updates[0]!]).toEqual([1, 2, 3]);
      expect([...loaded.updates[1]!]).toEqual([4, 5]);
      expect(loaded.seq).toBe(1);
    });
  });

  it('a linha é marcada como não cifrada', () => {
    const docId = newId();
    withoutKek(() => {
      sheetStore.create({ docId, bucketId: 'c:b', key: 'x.xlsx', fingerprint: null, snapshot: bytes(7) });
    });
    expect(kekVersionOf(docId)).toBe(PLAINTEXT_KEK_VERSION);
    expect(sheetStore.isSealed(docId)).toBe(false);
  });

  it('o blob no banco é o próprio conteúdo, sem envelope', () => {
    const docId = newId();
    withoutKek(() => {
      sheetStore.create({ docId, bucketId: 'c:b', key: 'x.xlsx', fingerprint: null, snapshot: bytes(11, 22, 33) });
    });
    expect([...snapshotOf(docId)]).toEqual([11, 22, 33]);
  });

  it('compacta e continua legível', () => {
    const docId = newId();
    withoutKek(() => {
      sheetStore.create({ docId, bucketId: 'c:b', key: 'x.xlsx', fingerprint: null, snapshot: bytes(1) });
      sheetStore.append(docId, bytes(2), 'ana');
      sheetStore.compact(docId, bytes(1, 2), 1);
      const loaded = sheetStore.load(docId)!;
      expect(loaded.updates).toHaveLength(1);
      expect([...loaded.updates[0]!]).toEqual([1, 2]);
      expect(sheetStore.countUpdates(docId)).toBe(0);
    });
  });
});

describe('rascunho com KEK', () => {
  it('continua cifrado, e o blob não é o conteúdo', () => {
    const docId = newId();
    sheetStore.create({ docId, bucketId: 'c:b', key: 'x.xlsx', fingerprint: null, snapshot: bytes(11, 22, 33) });

    expect(kekVersionOf(docId)).not.toBe(PLAINTEXT_KEK_VERSION);
    expect(sheetStore.isSealed(docId)).toBe(true);
    expect([...snapshotOf(docId)]).not.toEqual([11, 22, 33]);
    expect([...sheetStore.load(docId)!.updates[0]!]).toEqual([11, 22, 33]);
  });

  it('documento gravado em claro segue legível depois de configurar a KEK', () => {
    const docId = newId();
    withoutKek(() => {
      sheetStore.create({ docId, bucketId: 'c:b', key: 'x.xlsx', fingerprint: null, snapshot: bytes(5, 6) });
    });
    expect([...sheetStore.load(docId)!.updates[0]!]).toEqual([5, 6]);
  });
});

describe('o que continua barrado sem KEK', () => {
  const BUCKET = 'c:cifrado';

  it('bucket com criptografia ligada não abre', () => {
    objects.bucketCryptoStore.setEnabled(BUCKET, true);
    try {
      withoutKek(() => {
        expect(guard.blockedReason(BUCKET, 'x.xlsx')).toBe('sealed');
        expect(guard.canOpen(BUCKET, 'x.xlsx')).toBe(false);
      });
    } finally {
      objects.bucketCryptoStore.setEnabled(BUCKET, false);
    }
  });

  it('bucket em texto claro abre', () => {
    withoutKek(() => {
      expect(guard.blockedReason('c:claro', 'x.xlsx')).toBeNull();
      expect(guard.canOpen('c:claro', 'x.xlsx')).toBe(true);
    });
  });

  it('com KEK, bucket cifrado abre normalmente', () => {
    objects.bucketCryptoStore.setEnabled(BUCKET, true);
    try {
      expect(guard.canOpen(BUCKET, 'x.xlsx')).toBe(true);
    } finally {
      objects.bucketCryptoStore.setEnabled(BUCKET, false);
    }
  });
});
