// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { existsSync, writeFileSync } from 'node:fs';
import type { EscrowDest } from './dest';
import { decryptBundle } from './bundle';

export interface RestoreDeps {
  dest: EscrowDest;
  opener: { recoverySecret: string } | { vendorPub: Buffer; vendorPriv: Buffer };
  kekOutPath: string;
  dbOutPath: string;
  force: boolean;
}

export async function restoreFrom(deps: RestoreDeps): Promise<{ restoredKek: boolean; from: string }> {
  if (!deps.force && existsSync(deps.dbOutPath)) {
    throw new Error('escrow_refuse_overwrite');
  }

  const snaps = await deps.dest.list();
  if (snaps.length === 0) {
    throw new Error('escrow_no_snapshots');
  }

  let chosen: { key: string; kek: Buffer | null; dbBytes: Buffer } | null = null;
  for (const snap of snaps) {
    const blob = await deps.dest.get(snap.key);
    try {
      const { kek, dbBytes } = await decryptBundle(blob, deps.opener);
      chosen = { key: snap.key, kek, dbBytes };
      break;
    } catch {
      continue;
    }
  }

  if (!chosen) {
    throw new Error('escrow_restore_failed');
  }

  if (chosen.kek !== null && !deps.force && existsSync(deps.kekOutPath)) {
    throw new Error('escrow_refuse_overwrite');
  }

  if (chosen.kek !== null) {
    writeFileSync(deps.kekOutPath, chosen.kek.toString('base64'));
  }
  writeFileSync(deps.dbOutPath, chosen.dbBytes);

  return { restoredKek: chosen.kek !== null, from: chosen.key };
}
