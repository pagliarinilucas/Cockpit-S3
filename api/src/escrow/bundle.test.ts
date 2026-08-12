// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { test, expect } from 'bun:test';
import sodium from 'sodium-native';
import { encryptBundle, decryptBundle } from './bundle';
import { newVendorKeypair } from '../crypto/recovery';

const kek = () => { const k = Buffer.alloc(32); sodium.randombytes_buf(k); return k; };
const db = Buffer.from('conteudo-do-banco-sqlite-fake');

test('roundtrip pelo segredo de recuperação', async () => {
  const k = kek();
  const blob = await encryptBundle({ kek: k, dbBytes: db }, { recoverySecret: 'CODE-1234' });
  const out = await decryptBundle(blob, { recoverySecret: 'CODE-1234' });
  expect(out.kek?.equals(k)).toBe(true);
  expect(out.dbBytes.equals(db)).toBe(true);
});

test('roundtrip pela chave privada de vendor', async () => {
  const v = newVendorKeypair();
  const k = kek();
  const blob = await encryptBundle({ kek: k, dbBytes: db }, { recoverySecret: 'x', vendorPub: v.pub });
  const out = await decryptBundle(blob, { vendorPub: v.pub, vendorPriv: v.priv });
  expect(out.kek?.equals(k)).toBe(true);
});

test('segredo errado falha', async () => {
  const blob = await encryptBundle({ kek: kek(), dbBytes: db }, { recoverySecret: 'certo' });
  await expect(decryptBundle(blob, { recoverySecret: 'errado' })).rejects.toThrow();
});

test('byte adulterado falha (autenticação do secretstream)', async () => {
  const blob = await encryptBundle({ kek: kek(), dbBytes: db }, { recoverySecret: 's' });
  blob[blob.length - 1]! ^= 0xff;
  await expect(decryptBundle(blob, { recoverySecret: 's' })).rejects.toThrow();
});

test('bundle sem KEK restaura só o banco', async () => {
  const blob = await encryptBundle({ kek: null, dbBytes: db }, { recoverySecret: 's' });
  const out = await decryptBundle(blob, { recoverySecret: 's' });
  expect(out.kek).toBeNull();
  expect(out.dbBytes.equals(db)).toBe(true);
});
