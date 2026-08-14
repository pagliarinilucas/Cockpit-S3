// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * FASE 0 — smoke test do sodium-native no Bun.
 *
 * sodium-native é um addon nativo (N-API). Este teste é o portão go/no-go:
 * valida que TODAS as primitivas usadas pela criptografia at-rest carregam e
 * funcionam neste Bun antes de qualquer implementação depender delas.
 *
 * Se este arquivo falhar (segfault, ABI, símbolo ausente), PARAR: reavaliar a
 * stack (ex.: libsodium-wrappers em WASM) antes de continuar.
 *
 * Roda no CI via `bun test`. Não loga material de chave.
 */
import { describe, it, expect } from 'bun:test';
import sodium from 'sodium-native';

describe('sodium-native fase 0', () => {
  it('randombytes_buf preenche o buffer com bytes', () => {
    const a = Buffer.alloc(32);
    const b = Buffer.alloc(32);
    sodium.randombytes_buf(a);
    sodium.randombytes_buf(b);
    // Chance de dois buffers de 32 bytes serem iguais é ~2^-256.
    expect(a.equals(b)).toBe(false);
    expect(a.equals(Buffer.alloc(32))).toBe(false);
  });

  it('sodium_memzero zera um buffer', () => {
    const buf = Buffer.alloc(32);
    sodium.randombytes_buf(buf);
    expect(buf.equals(Buffer.alloc(32))).toBe(false);
    sodium.sodium_memzero(buf);
    expect(buf.equals(Buffer.alloc(32))).toBe(true);
  });

  it('crypto_aead_xchacha20poly1305_ietf faz wrap/unwrap (usado para wrap da DEK)', () => {
    const key = Buffer.alloc(sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
    sodium.crypto_aead_xchacha20poly1305_ietf_keygen(key);

    const nonce = Buffer.alloc(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    sodium.randombytes_buf(nonce);

    const message = Buffer.from('dek-de-32-bytes-simulada--------'); // 32 bytes
    const ad = Buffer.from('kek-version:1');

    const ciphertext = Buffer.alloc(message.length + sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES);
    sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(ciphertext, message, ad, null, nonce, key);

    const decrypted = Buffer.alloc(ciphertext.length - sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES);
    sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(decrypted, null, ciphertext, ad, nonce, key);
    expect(decrypted.equals(message)).toBe(true);

    // Corrupção de 1 byte do ciphertext deve falhar a autenticação.
    const tampered = Buffer.from(ciphertext);
    tampered[0]! ^= 0x01;
    expect(() =>
      sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(decrypted, null, tampered, ad, nonce, key),
    ).toThrow();

    // AD errado deve falhar.
    expect(() =>
      sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(decrypted, null, ciphertext, Buffer.from('kek-version:2'), nonce, key),
    ).toThrow();
  });

  it('crypto_secretstream_xchacha20poly1305 faz push/pull em chunks com TAG_FINAL', () => {
    const key = Buffer.alloc(sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES);
    sodium.crypto_secretstream_xchacha20poly1305_keygen(key);

    // ---- push (encrypt) ----
    const pushState = Buffer.alloc(sodium.crypto_secretstream_xchacha20poly1305_STATEBYTES);
    const header = Buffer.alloc(sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES);
    sodium.crypto_secretstream_xchacha20poly1305_init_push(pushState, header, key);

    const chunks = [Buffer.from('chunk-0'), Buffer.from('chunk-1'), Buffer.from('chunk-final')];
    const ABYTES = sodium.crypto_secretstream_xchacha20poly1305_ABYTES;
    const TAG_MESSAGE = sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE;
    const TAG_FINAL = sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL;

    const encChunks: Buffer[] = [];
    chunks.forEach((m, i) => {
      const c = Buffer.alloc(m.length + ABYTES);
      const tag = i === chunks.length - 1 ? TAG_FINAL : TAG_MESSAGE;
      sodium.crypto_secretstream_xchacha20poly1305_push(pushState, c, m, null, tag);
      encChunks.push(c);
    });

    // ---- pull (decrypt) ----
    const pullState = Buffer.alloc(sodium.crypto_secretstream_xchacha20poly1305_STATEBYTES);
    sodium.crypto_secretstream_xchacha20poly1305_init_pull(pullState, header, key);

    const tagOut = Buffer.alloc(1);
    encChunks.forEach((c, i) => {
      const m = Buffer.alloc(c.length - ABYTES);
      sodium.crypto_secretstream_xchacha20poly1305_pull(pullState, m, tagOut, c, null);
      expect(m.equals(chunks[i]!)).toBe(true);
      const expectedTag = i === encChunks.length - 1 ? TAG_FINAL : TAG_MESSAGE;
      expect(tagOut[0]).toBe(expectedTag);
    });
  });

  it('secretstream detecta corrupção, reordenação e chave errada', () => {
    const key = Buffer.alloc(sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES);
    sodium.crypto_secretstream_xchacha20poly1305_keygen(key);
    const ABYTES = sodium.crypto_secretstream_xchacha20poly1305_ABYTES;

    const pushState = Buffer.alloc(sodium.crypto_secretstream_xchacha20poly1305_STATEBYTES);
    const header = Buffer.alloc(sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES);
    sodium.crypto_secretstream_xchacha20poly1305_init_push(pushState, header, key);

    const c0 = Buffer.alloc('aaaa'.length + ABYTES);
    const c1 = Buffer.alloc('bbbb'.length + ABYTES);
    sodium.crypto_secretstream_xchacha20poly1305_push(pushState, c0, Buffer.from('aaaa'), null, sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE);
    sodium.crypto_secretstream_xchacha20poly1305_push(pushState, c1, Buffer.from('bbbb'), null, sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL);

    // Corrupção de 1 byte.
    {
      const pullState = Buffer.alloc(sodium.crypto_secretstream_xchacha20poly1305_STATEBYTES);
      sodium.crypto_secretstream_xchacha20poly1305_init_pull(pullState, header, key);
      const bad = Buffer.from(c0);
      bad[0]! ^= 0x01;
      const m = Buffer.alloc(bad.length - ABYTES);
      const tagOut = Buffer.alloc(1);
      expect(() => sodium.crypto_secretstream_xchacha20poly1305_pull(pullState, m, tagOut, bad, null)).toThrow();
    }

    // Reordenação: tentar ler c1 antes de c0.
    {
      const pullState = Buffer.alloc(sodium.crypto_secretstream_xchacha20poly1305_STATEBYTES);
      sodium.crypto_secretstream_xchacha20poly1305_init_pull(pullState, header, key);
      const m = Buffer.alloc(c1.length - ABYTES);
      const tagOut = Buffer.alloc(1);
      expect(() => sodium.crypto_secretstream_xchacha20poly1305_pull(pullState, m, tagOut, c1, null)).toThrow();
    }

    // Chave errada.
    {
      const wrongKey = Buffer.alloc(sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES);
      sodium.crypto_secretstream_xchacha20poly1305_keygen(wrongKey);
      const pullState = Buffer.alloc(sodium.crypto_secretstream_xchacha20poly1305_STATEBYTES);
      // header foi gerado com `key`; init_pull com wrongKey + pull deve falhar.
      sodium.crypto_secretstream_xchacha20poly1305_init_pull(pullState, header, wrongKey);
      const m = Buffer.alloc(c0.length - ABYTES);
      const tagOut = Buffer.alloc(1);
      expect(() => sodium.crypto_secretstream_xchacha20poly1305_pull(pullState, m, tagOut, c0, null)).toThrow();
    }
  });

  it('crypto_pwhash argon2id deriva chave a partir de passphrase (usado no sealed mode)', () => {
    // O smoke test usa parâmetros MODERATE para ser rápido no CI; o
    // SealedKekProvider usará SENSITIVE em produção (resistência a brute-force
    // offline do arquivo sealed).
    const salt = Buffer.alloc(sodium.crypto_pwhash_SALTBYTES);
    sodium.randombytes_buf(salt);
    const passphrase = Buffer.from('senha-de-teste-do-smoke');

    const derive = () => {
      const out = Buffer.alloc(32);
      sodium.crypto_pwhash(
        out,
        passphrase,
        salt,
        sodium.crypto_pwhash_OPSLIMIT_MODERATE,
        sodium.crypto_pwhash_MEMLIMIT_MODERATE,
        sodium.crypto_pwhash_ALG_ARGON2ID13,
      );
      return out;
    };

    const k1 = derive();
    const k2 = derive();
    // Determinístico: mesma passphrase + salt + params → mesma chave.
    expect(k1.equals(k2)).toBe(true);
    expect(k1.equals(Buffer.alloc(32))).toBe(false);

    // Salt diferente → chave diferente.
    sodium.randombytes_buf(salt);
    const k3 = derive();
    expect(k1.equals(k3)).toBe(false);
  });
});
