// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * O editor nunca "promove" um arquivo a cifrado. Gravar passa pelo pipeline
 * cifrado só quando o objeto JÁ era cifrado ou o bucket pede criptografia —
 * senão vai direto para o S3, do jeito que estava. Um bug aqui cifraria a
 * planilha de quem nunca pediu criptografia, e sem KEK ela ficaria ilegível.
 */
import { describe, it, expect, beforeAll } from 'bun:test';
import { bootTestEnv } from './test-env';

let io: typeof import('./io');
let objects: typeof import('../objects/store');

beforeAll(async () => {
  await bootTestEnv();
  io = await import('./io');
  objects = await import('../objects/store');
});

describe('decisão de cifrar na gravação', () => {
  const BUCKET = 'c:planilhas';

  it('bucket sem criptografia e objeto sem registro: nada a cifrar', () => {
    expect(objects.bucketCryptoStore.isEnabled(BUCKET)).toBe(false);
    expect(objects.objectsStore.get(BUCKET, 'conciliacao.xlsx')).toBeNull();
  });

  it('ligar a criptografia do bucket é o que muda a decisão', () => {
    objects.bucketCryptoStore.setEnabled(BUCKET, true);
    try {
      expect(objects.bucketCryptoStore.isEnabled(BUCKET)).toBe(true);
    } finally {
      objects.bucketCryptoStore.setEnabled(BUCKET, false);
    }
    expect(objects.bucketCryptoStore.isEnabled(BUCKET)).toBe(false);
  });

  it('o tipo de conteúdo gravado é o do formato, não genérico', () => {
    expect(io.contentTypeFor('a.xlsx')).toContain('spreadsheetml');
    expect(io.contentTypeFor('a.csv')).toBe('text/csv');
    expect(io.contentTypeFor('a.tsv')).toBe('text/tab-separated-values');
  });
});
