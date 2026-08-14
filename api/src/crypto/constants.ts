// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/** Constantes da criptografia at-rest. Centraliza os valores do libsodium. */
import sodium from 'sodium-native';

export const DEFAULT_ORG = 'default';

/** Tamanho do chunk de plaintext por bloco do secretstream (1 MiB). */
export const CHUNK_SIZE = 1024 * 1024;

// secretstream xchacha20poly1305
export const KEYBYTES = sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES;
export const HEADERBYTES = sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES;
export const ABYTES = sodium.crypto_secretstream_xchacha20poly1305_ABYTES;
export const STATEBYTES = sodium.crypto_secretstream_xchacha20poly1305_STATEBYTES;
export const TAG_MESSAGE = sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE;
export const TAG_FINAL = sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL;

// AEAD xchacha20poly1305_ietf (wrap da DEK e verificador da KEK)
export const AEAD_KEYBYTES = sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES;
export const AEAD_NPUBBYTES = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
export const AEAD_ABYTES = sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES;

/** Tamanho do blob cifrado no S3 (o header vai no banco, NÃO no blob). */
export function cipherBlobSize(sizePlain: number): number {
  const nChunks = Math.max(1, Math.ceil(sizePlain / CHUNK_SIZE));
  return sizePlain + nChunks * ABYTES;
}
