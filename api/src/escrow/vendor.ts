// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { createHash } from 'node:crypto';

export const VENDOR_PUBKEY_B64 = '';

export function vendorPubkey(): Buffer | null {
  if (!VENDOR_PUBKEY_B64) return null;
  const b = Buffer.from(VENDOR_PUBKEY_B64, 'base64');
  return b.length === 32 ? b : null;
}

export function vendorFingerprint(): string | null {
  const pk = vendorPubkey();
  return pk ? createHash('sha256').update(pk).digest('hex').slice(0, 16) : null;
}
