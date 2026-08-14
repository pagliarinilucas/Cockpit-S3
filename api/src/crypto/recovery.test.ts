// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { test, expect } from 'bun:test';
import sodium from 'sodium-native';
import {
  generateRecoveryCode, defaultArgonParams, wrapKeyWithSecret, unwrapKeyWithSecret,
  sealToVendor, openFromVendor, newVendorKeypair,
} from './recovery';

const key = () => { const k = Buffer.alloc(32); sodium.randombytes_buf(k); return k; };

test('código de recuperação tem entropia e é estável no formato', () => {
  const c = generateRecoveryCode();
  expect(c.replace(/[^A-Z2-7]/gi, '').length).toBeGreaterThanOrEqual(52);
  expect(generateRecoveryCode()).not.toBe(c);
});

test('wrap/unwrap por segredo faz roundtrip', () => {
  const k = key();
  const { salt, params, wrapped } = wrapKeyWithSecret(k, 'ABC-123');
  expect(unwrapKeyWithSecret(wrapped, 'ABC-123', salt, params).equals(k)).toBe(true);
});

test('segredo errado falha o unwrap', () => {
  const k = key();
  const { salt, params, wrapped } = wrapKeyWithSecret(k, 'certo');
  expect(() => unwrapKeyWithSecret(wrapped, 'errado', salt, params)).toThrow();
});

test('params gravados recomputam a chave mesmo se diferirem do default', () => {
  const k = key();
  const params = { ...defaultArgonParams(), opslimit: defaultArgonParams().opslimit + 1 };
  const salt = Buffer.alloc(sodium.crypto_pwhash_SALTBYTES); sodium.randombytes_buf(salt);
  const { wrapped } = wrapKeyWithSecret(k, 's', params, salt);
  expect(unwrapKeyWithSecret(wrapped, 's', salt, params).equals(k)).toBe(true);
});

test('sealed box de/para vendor faz roundtrip; chave errada falha', () => {
  const k = key();
  const v = newVendorKeypair();
  const sealed = sealToVendor(k, v.pub);
  expect(openFromVendor(sealed, v.pub, v.priv).equals(k)).toBe(true);
  const other = newVendorKeypair();
  expect(() => openFromVendor(sealed, other.pub, other.priv)).toThrow();
});
