// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import sodium from 'sodium-native';
import { AEAD_KEYBYTES } from './constants';
import { wrapDek, unwrapDek } from './index';

export interface ArgonParams { opslimit: number; memlimit: number; alg: number }

export function defaultArgonParams(): ArgonParams {
  return {
    opslimit: sodium.crypto_pwhash_OPSLIMIT_MODERATE,
    memlimit: sodium.crypto_pwhash_MEMLIMIT_MODERATE,
    alg: sodium.crypto_pwhash_ALG_ARGON2ID13,
  };
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf: Buffer): string {
  let bits = 0, val = 0, out = '';
  for (const b of buf) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) out += B32[(val << (5 - bits)) & 31];
  return out.replace(/(.{4})/g, '$1-').replace(/-$/, '');
}

export function generateRecoveryCode(): string {
  const raw = Buffer.alloc(32);
  sodium.randombytes_buf(raw);
  const s = base32(raw);
  sodium.sodium_memzero(raw);
  return s;
}

export function deriveKey(secret: string, salt: Buffer, params: ArgonParams): Buffer {
  const out = Buffer.alloc(AEAD_KEYBYTES);
  const pw = Buffer.from(secret, 'utf8');
  sodium.crypto_pwhash(out, pw, salt, params.opslimit, params.memlimit, params.alg);
  sodium.sodium_memzero(pw);
  return out;
}

export function wrapKeyWithSecret(
  key: Buffer, secret: string, params: ArgonParams = defaultArgonParams(), salt?: Buffer,
): { salt: Buffer; params: ArgonParams; wrapped: Buffer } {
  const s = salt ?? Buffer.alloc(sodium.crypto_pwhash_SALTBYTES);
  if (!salt) sodium.randombytes_buf(s);
  const dk = deriveKey(secret, s, params);
  try { return { salt: s, params, wrapped: wrapDek(key, dk) }; }
  finally { sodium.sodium_memzero(dk); }
}

export function unwrapKeyWithSecret(wrapped: Buffer, secret: string, salt: Buffer, params: ArgonParams): Buffer {
  const dk = deriveKey(secret, salt, params);
  try { return unwrapDek(wrapped, dk); }
  finally { sodium.sodium_memzero(dk); }
}

export function newVendorKeypair(): { pub: Buffer; priv: Buffer } {
  const pub = Buffer.alloc(sodium.crypto_box_PUBLICKEYBYTES);
  const priv = Buffer.alloc(sodium.crypto_box_SECRETKEYBYTES);
  sodium.crypto_box_keypair(pub, priv);
  return { pub, priv };
}

export function sealToVendor(key: Buffer, vendorPub: Buffer): Buffer {
  const sealed = Buffer.alloc(key.length + sodium.crypto_box_SEALBYTES);
  sodium.crypto_box_seal(sealed, key, vendorPub);
  return sealed;
}

export function openFromVendor(sealed: Buffer, vendorPub: Buffer, vendorPriv: Buffer): Buffer {
  const out = Buffer.alloc(sealed.length - sodium.crypto_box_SEALBYTES);
  if (!sodium.crypto_box_seal_open(out, sealed, vendorPub, vendorPriv)) throw new Error('vendor_unseal_failed');
  return out;
}
