// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/** Geração e envelope (wrap/unwrap) de chaves. Nunca loga material de chave. */
import sodium from 'sodium-native';
import { AEAD_KEYBYTES, AEAD_NPUBBYTES, AEAD_ABYTES, KEYBYTES } from './constants';

const VERIFIER_PLAINTEXT = Buffer.from('cockpit-s3-kek-verifier-v1');

export function generateKek(): Buffer {
  const kek = Buffer.alloc(AEAD_KEYBYTES);
  sodium.randombytes_buf(kek);
  return kek;
}

export function generateDek(): Buffer {
  const dek = Buffer.alloc(KEYBYTES);
  sodium.crypto_secretstream_xchacha20poly1305_keygen(dek);
  return dek;
}

/** AEAD encrypt com nonce aleatório prefixado: [nonce | ct+tag]. */
function aeadSeal(plain: Buffer, key: Buffer, ad: Buffer | null): Buffer {
  const nonce = Buffer.alloc(AEAD_NPUBBYTES);
  sodium.randombytes_buf(nonce);
  const ct = Buffer.alloc(plain.length + AEAD_ABYTES);
  sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(ct, plain, ad, null, nonce, key);
  return Buffer.concat([nonce, ct]);
}

function aeadOpen(blob: Buffer, key: Buffer, ad: Buffer | null): Buffer {
  const nonce = blob.subarray(0, AEAD_NPUBBYTES);
  const ct = blob.subarray(AEAD_NPUBBYTES);
  const out = Buffer.alloc(ct.length - AEAD_ABYTES);
  sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(out, null, ct, ad, nonce, key);
  return out;
}

export function wrapDek(dek: Buffer, kek: Buffer): Buffer {
  return aeadSeal(dek, kek, null);
}

export function unwrapDek(wrapped: Buffer, kek: Buffer): Buffer {
  return aeadOpen(wrapped, kek, null);
}

/** Sentinela cifrado com a KEK, guardado em org_keys p/ fail-fast (finding I). */
export function makeVerifier(kek: Buffer): Buffer {
  return aeadSeal(VERIFIER_PLAINTEXT, kek, null);
}

export function checkVerifier(verifier: Buffer, kek: Buffer): boolean {
  try {
    return aeadOpen(verifier, kek, null).equals(VERIFIER_PLAINTEXT);
  } catch {
    return false;
  }
}
