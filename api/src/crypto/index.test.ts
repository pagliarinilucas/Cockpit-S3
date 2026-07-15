// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, it, expect } from 'bun:test';
import { generateKek, generateDek, wrapDek, unwrapDek, makeVerifier, checkVerifier } from './index';

describe('crypto keys', () => {
  it('gera KEK e DEK de 32 bytes, aleatórias', () => {
    expect(generateKek().length).toBe(32);
    expect(generateDek().length).toBe(32);
    expect(generateKek().equals(generateKek())).toBe(false);
  });

  it('wrap/unwrap da DEK faz roundtrip', () => {
    const kek = generateKek();
    const dek = generateDek();
    const wrapped = wrapDek(dek, kek);
    expect(wrapped.equals(dek)).toBe(false); // cifrado
    expect(unwrapDek(wrapped, kek).equals(dek)).toBe(true);
  });

  it('unwrap com KEK errada falha', () => {
    const wrapped = wrapDek(generateDek(), generateKek());
    expect(() => unwrapDek(wrapped, generateKek())).toThrow();
  });

  it('unwrap com blob corrompido falha', () => {
    const kek = generateKek();
    const wrapped = wrapDek(generateDek(), kek);
    wrapped[wrapped.length - 1] ^= 0x01;
    expect(() => unwrapDek(wrapped, kek)).toThrow();
  });

  it('verificador confere só com a KEK certa', () => {
    const kek = generateKek();
    const v = makeVerifier(kek);
    expect(checkVerifier(v, kek)).toBe(true);
    expect(checkVerifier(v, generateKek())).toBe(false);
  });
});
