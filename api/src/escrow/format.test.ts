// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { test, expect } from 'bun:test';
import { serializeEscrow, parseEscrow, FORMAT_VERSION, type EscrowHeader } from './format';
import { defaultArgonParams } from '../crypto/recovery';

const hdr = (): EscrowHeader => ({
  formatVersion: FORMAT_VERSION, createdAt: '2026-07-17T00:00:00.000Z',
  argonSalt: Buffer.from('salt-16-bytes...'), argonParams: defaultArgonParams(),
  ebkWrappedPassphrase: Buffer.from('wrapped'), ebkSealedVendor: Buffer.from('sealed'),
  streamHeader: Buffer.from('header'),
});

test('roundtrip serializa/parseia cabeçalho + cipher', () => {
  const cipher = new Uint8Array([1, 2, 3, 4, 5]);
  const { header, cipher: c } = parseEscrow(serializeEscrow(hdr(), cipher));
  expect(header.createdAt).toBe('2026-07-17T00:00:00.000Z');
  expect(header.ebkSealedVendor?.equals(Buffer.from('sealed'))).toBe(true);
  expect(header.argonParams.alg).toBe(defaultArgonParams().alg);
  expect(Buffer.from(c).equals(Buffer.from(cipher))).toBe(true);
});

test('ebkSealedVendor ausente vira null', () => {
  const h = { ...hdr(), ebkSealedVendor: null };
  expect(parseEscrow(serializeEscrow(h, new Uint8Array())).header.ebkSealedVendor).toBeNull();
});

test('magic inválido é rejeitado', () => {
  const good = serializeEscrow(hdr(), new Uint8Array([9]));
  good[0] = 0x00;
  expect(() => parseEscrow(good)).toThrow();
});

test('formatVersion desconhecido é rejeitado', () => {
  const blob = serializeEscrow({ ...hdr(), formatVersion: 999 }, new Uint8Array([9]));
  expect(() => parseEscrow(blob)).toThrow();
});
