// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Tipos ambiente mínimos para `sodium-native@5.1.0` (o pacote não publica
 * tipos próprios). Cobre exatamente os símbolos usados no módulo crypto/*:
 * constants.ts, index.ts, stream.ts e sodium.smoke.test.ts.
 */
declare module 'sodium-native' {
  interface SodiumNative {
    // ---- secretstream xchacha20poly1305 ----
    readonly crypto_secretstream_xchacha20poly1305_KEYBYTES: number;
    readonly crypto_secretstream_xchacha20poly1305_HEADERBYTES: number;
    readonly crypto_secretstream_xchacha20poly1305_ABYTES: number;
    readonly crypto_secretstream_xchacha20poly1305_STATEBYTES: number;
    readonly crypto_secretstream_xchacha20poly1305_TAG_MESSAGE: number;
    readonly crypto_secretstream_xchacha20poly1305_TAG_FINAL: number;

    crypto_secretstream_xchacha20poly1305_keygen(k: Buffer): void;
    crypto_secretstream_xchacha20poly1305_init_push(state: Buffer, header: Buffer, k: Buffer): void;
    crypto_secretstream_xchacha20poly1305_push(
      state: Buffer,
      c: Buffer,
      m: Buffer,
      ad: Buffer | null,
      tag: number,
    ): number;
    crypto_secretstream_xchacha20poly1305_init_pull(state: Buffer, header: Buffer, k: Buffer): void;
    crypto_secretstream_xchacha20poly1305_pull(
      state: Buffer,
      m: Buffer,
      tag: Buffer,
      c: Buffer,
      ad: Buffer | null,
    ): number;

    // ---- AEAD xchacha20poly1305_ietf ----
    readonly crypto_aead_xchacha20poly1305_ietf_KEYBYTES: number;
    readonly crypto_aead_xchacha20poly1305_ietf_NPUBBYTES: number;
    readonly crypto_aead_xchacha20poly1305_ietf_ABYTES: number;

    crypto_aead_xchacha20poly1305_ietf_keygen(k: Buffer): void;
    crypto_aead_xchacha20poly1305_ietf_encrypt(
      c: Buffer,
      m: Buffer,
      ad: Buffer | null,
      nsec: null,
      npub: Buffer,
      k: Buffer,
    ): number;
    crypto_aead_xchacha20poly1305_ietf_decrypt(
      m: Buffer,
      nsec: null,
      c: Buffer,
      ad: Buffer | null,
      npub: Buffer,
      k: Buffer,
    ): number;

    // ---- pwhash (argon2id, usado no sealed mode) ----
    readonly crypto_pwhash_SALTBYTES: number;
    readonly crypto_pwhash_OPSLIMIT_MODERATE: number;
    readonly crypto_pwhash_MEMLIMIT_MODERATE: number;
    readonly crypto_pwhash_ALG_ARGON2ID13: number;

    crypto_pwhash(
      out: Buffer,
      passwd: Buffer,
      salt: Buffer,
      opslimit: number,
      memlimit: number,
      alg: number,
    ): void;

    readonly crypto_box_PUBLICKEYBYTES: number;
    readonly crypto_box_SECRETKEYBYTES: number;
    readonly crypto_box_SEALBYTES: number;
    crypto_box_keypair(pk: Buffer, sk: Buffer): void;
    crypto_box_seal(c: Buffer, m: Buffer, pk: Buffer): void;
    crypto_box_seal_open(m: Buffer, c: Buffer, pk: Buffer, sk: Buffer): boolean;

    readonly crypto_pwhash_OPSLIMIT_SENSITIVE: number;
    readonly crypto_pwhash_MEMLIMIT_SENSITIVE: number;

    // ---- utilidades gerais ----
    randombytes_buf(buf: Buffer): void;
    sodium_memzero(buf: Buffer): void;
  }

  const sodium: SodiumNative;
  export default sodium;
}
