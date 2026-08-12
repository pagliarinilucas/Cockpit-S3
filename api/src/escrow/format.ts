// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import type { ArgonParams } from '../crypto/recovery';

export const FORMAT_VERSION = 1;
const MAGIC = 'CSE1';

export interface EscrowHeader {
  formatVersion: number;
  createdAt: string;
  argonSalt: Buffer;
  argonParams: ArgonParams;
  ebkWrappedPassphrase: Buffer;
  ebkSealedVendor: Buffer | null;
  streamHeader: Buffer;
}

interface SerializedEscrowHeader {
  formatVersion: number;
  createdAt: string;
  argonSalt: string;
  argonParams: ArgonParams;
  ebkWrappedPassphrase: string;
  ebkSealedVendor: string | null;
  streamHeader: string;
}

export function serializeEscrow(header: EscrowHeader, cipher: Uint8Array): Buffer {
  const serialized: SerializedEscrowHeader = {
    formatVersion: header.formatVersion,
    createdAt: header.createdAt,
    argonSalt: header.argonSalt.toString('base64'),
    argonParams: header.argonParams,
    ebkWrappedPassphrase: header.ebkWrappedPassphrase.toString('base64'),
    ebkSealedVendor: header.ebkSealedVendor ? header.ebkSealedVendor.toString('base64') : null,
    streamHeader: header.streamHeader.toString('base64'),
  };
  const headerJson = Buffer.from(JSON.stringify(serialized), 'utf8');
  const headerLen = Buffer.alloc(4);
  headerLen.writeUInt32LE(headerJson.length, 0);
  return Buffer.concat([Buffer.from(MAGIC, 'ascii'), headerLen, headerJson, cipher]);
}

export function parseEscrow(bytes: Buffer): { header: EscrowHeader; cipher: Buffer } {
  if (bytes.length < 8) throw new Error('escrow_too_short');
  const magic = bytes.subarray(0, 4).toString('ascii');
  if (magic !== MAGIC) throw new Error('escrow_bad_magic');
  const headerLen = bytes.readUInt32LE(4);
  if (8 + headerLen > bytes.length) throw new Error('escrow_bad_header_len');
  const headerJson = bytes.subarray(8, 8 + headerLen).toString('utf8');
  const serialized = JSON.parse(headerJson) as SerializedEscrowHeader;
  if (serialized.formatVersion !== FORMAT_VERSION) throw new Error('escrow_bad_format_version');
  const header: EscrowHeader = {
    formatVersion: serialized.formatVersion,
    createdAt: serialized.createdAt,
    argonSalt: Buffer.from(serialized.argonSalt, 'base64'),
    argonParams: serialized.argonParams,
    ebkWrappedPassphrase: Buffer.from(serialized.ebkWrappedPassphrase, 'base64'),
    ebkSealedVendor: serialized.ebkSealedVendor ? Buffer.from(serialized.ebkSealedVendor, 'base64') : null,
    streamHeader: Buffer.from(serialized.streamHeader, 'base64'),
  };
  const cipher = bytes.subarray(8 + headerLen);
  return { header, cipher };
}
