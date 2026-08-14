// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { createHash } from 'node:crypto';
import sodium from 'sodium-native';
import { generateDek } from '../crypto/index';
import { encryptStream, decryptStream } from '../crypto/stream';
import {
  wrapKeyWithSecret,
  unwrapKeyWithSecret,
  sealToVendor,
  openFromVendor,
  defaultArgonParams,
  type ArgonParams,
} from '../crypto/recovery';
import { serializeEscrow, parseEscrow, FORMAT_VERSION, type EscrowHeader } from './format';

export interface BundleInput {
  kek: Buffer | null;
  dbBytes: Buffer;
}

export interface EncryptOpts {
  recoverySecret: string;
  vendorPub?: Buffer | null;
  argonParams?: ArgonParams;
}

const KEK_FP_LEN = 16;

function kekFingerprint(kek: Buffer): Buffer {
  return Buffer.from(createHash('sha256').update(kek).digest('hex').slice(0, KEK_FP_LEN), 'ascii');
}

function buildInnerBundle(input: BundleInput): Buffer {
  if (input.kek) {
    const fp = kekFingerprint(input.kek);
    const dbLen = Buffer.alloc(4);
    dbLen.writeUInt32LE(input.dbBytes.length, 0);
    return Buffer.concat([Buffer.from([fp.length]), fp, Buffer.from([input.kek.length]), input.kek, dbLen, input.dbBytes]);
  }
  const dbLen = Buffer.alloc(4);
  dbLen.writeUInt32LE(input.dbBytes.length, 0);
  return Buffer.concat([Buffer.from([0]), Buffer.from([0]), dbLen, input.dbBytes]);
}

function parseInnerBundle(bytes: Buffer): BundleInput {
  let offset = 0;
  const fpLen = bytes.readUInt8(offset);
  offset += 1;
  const fp = fpLen ? bytes.subarray(offset, offset + fpLen) : Buffer.alloc(0);
  offset += fpLen;
  const kekLen = bytes.readUInt8(offset);
  offset += 1;
  let kek: Buffer | null = null;
  if (kekLen) {
    kek = bytes.subarray(offset, offset + kekLen);
    offset += kekLen;
    const expectedFp = kekFingerprint(kek);
    if (!fp.equals(expectedFp)) throw new Error('kek_fingerprint_mismatch');
  }
  const dbLen = bytes.readUInt32LE(offset);
  offset += 4;
  const dbBytes = bytes.subarray(offset, offset + dbLen);
  return { kek, dbBytes };
}

async function encryptWithStream(ebk: Buffer, plain: Buffer): Promise<{ header: Buffer; cipher: Buffer }> {
  const { header, transform } = encryptStream(ebk);
  const src = new Response(plain).body!;
  const cipher = Buffer.from(await new Response(src.pipeThrough(transform)).arrayBuffer());
  return { header, cipher };
}

async function decryptWithStream(ebk: Buffer, header: Buffer, cipher: Buffer): Promise<Buffer> {
  const src = new Response(cipher).body!;
  return Buffer.from(await new Response(src.pipeThrough(decryptStream(ebk, header))).arrayBuffer());
}

export async function encryptBundle(input: BundleInput, opts: EncryptOpts): Promise<Buffer> {
  const ebk = generateDek();
  try {
    const inner = buildInnerBundle(input);
    const { header: streamHeader, cipher } = await encryptWithStream(ebk, inner);
    const argonParams = opts.argonParams ?? defaultArgonParams();
    const wrapped = wrapKeyWithSecret(ebk, opts.recoverySecret, argonParams);
    const ebkSealedVendor = opts.vendorPub ? sealToVendor(ebk, opts.vendorPub) : null;
    const header: EscrowHeader = {
      formatVersion: FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      argonSalt: wrapped.salt,
      argonParams: wrapped.params,
      ebkWrappedPassphrase: wrapped.wrapped,
      ebkSealedVendor,
      streamHeader,
    };
    return serializeEscrow(header, cipher);
  } finally {
    sodium.sodium_memzero(ebk);
  }
}

export async function decryptBundle(
  bytes: Buffer,
  opener: { recoverySecret: string } | { vendorPub: Buffer; vendorPriv: Buffer },
): Promise<BundleInput> {
  const { header, cipher } = parseEscrow(bytes);
  const ebk =
    'recoverySecret' in opener
      ? unwrapKeyWithSecret(header.ebkWrappedPassphrase, opener.recoverySecret, header.argonSalt, header.argonParams)
      : (() => {
          if (!header.ebkSealedVendor) throw new Error('no_vendor_seal_in_bundle');
          return openFromVendor(header.ebkSealedVendor, opener.vendorPub, opener.vendorPriv);
        })();
  try {
    const inner = await decryptWithStream(ebk, header.streamHeader, cipher);
    return parseInnerBundle(inner);
  } finally {
    sodium.sodium_memzero(ebk);
  }
}
