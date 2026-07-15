// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

const DB = join(tmpdir(), `cockpit-objs-${crypto.randomUUID()}.sqlite`);
process.env.DB_PATH = DB;

let objectsStore: typeof import('./store').objectsStore;
let bucketCryptoStore: typeof import('./store').bucketCryptoStore;

beforeAll(async () => {
  await import('../db'); // materializa o schema no arquivo isolado
  ({ objectsStore, bucketCryptoStore } = await import('./store'));
});
afterAll(() => { for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true }); });

const row = (key: string, s3Key: string) => ({
  bucketId: 'c:b', key, s3Key, dekWrapped: Buffer.from('w'), kekVersion: 1,
  streamHeader: Buffer.from('h'), sizePlain: 10, sizeCipher: 27, contentType: 'text/plain',
});

describe('objectsStore', () => {
  it('upsert insere e get lê', () => {
    const { oldS3Key } = objectsStore.upsertReturningOld(row('a.txt', 'uuid-1'));
    expect(oldS3Key).toBeNull();
    expect(objectsStore.get('c:b', 'a.txt')?.s3Key).toBe('uuid-1');
  });

  it('upsert na mesma key retorna o s3_key antigo', () => {
    objectsStore.upsertReturningOld(row('a.txt', 'uuid-1'));
    const { oldS3Key } = objectsStore.upsertReturningOld(row('a.txt', 'uuid-2'));
    expect(oldS3Key).toBe('uuid-1');
    expect(objectsStore.get('c:b', 'a.txt')?.s3Key).toBe('uuid-2');
  });

  it('listPrefix filtra por prefixo', () => {
    objectsStore.upsertReturningOld(row('docs/x.txt', 'u3'));
    objectsStore.upsertReturningOld(row('docs/y.txt', 'u4'));
    const keys = objectsStore.listPrefix('c:b', 'docs/').map((r) => r.key).sort();
    expect(keys).toEqual(['docs/x.txt', 'docs/y.txt']);
  });

  it('remove apaga e retorna a linha', () => {
    objectsStore.upsertReturningOld(row('del.txt', 'u5'));
    expect(objectsStore.remove('c:b', 'del.txt')?.s3Key).toBe('u5');
    expect(objectsStore.get('c:b', 'del.txt')).toBeNull();
  });
});

describe('bucketCryptoStore', () => {
  it('default é desabilitado; setEnabled liga/desliga', () => {
    expect(bucketCryptoStore.isEnabled('c:b')).toBe(false);
    bucketCryptoStore.setEnabled('c:b', true);
    expect(bucketCryptoStore.isEnabled('c:b')).toBe(true);
    bucketCryptoStore.setEnabled('c:b', false);
    expect(bucketCryptoStore.isEnabled('c:b')).toBe(false);
  });
});
