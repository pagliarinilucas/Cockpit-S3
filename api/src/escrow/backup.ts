// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { randomUUID } from 'node:crypto';
import { snapshotToBuffer } from './snapshot';
import { encryptBundle, decryptBundle } from './bundle';
import { readKekBytes, config } from '../config';
import { sqlite } from '../db';
import type { EscrowDest } from './dest';
import { planRetention, type Snapshot } from './retention';
import { escrowStore } from './store';
import { vendorPubkey } from './vendor';
import { s3Dest } from './dest';

export interface RunBackupDeps {
  dest: EscrowDest;
  dbPath: string;
  recoverySecret: string;
  vendorPub: Buffer | null;
  now: number;
  spoolDir?: string;
}

let busy = false;

export async function runBackupOnce(deps: RunBackupDeps): Promise<{ key: string; removed: number }> {
  if (busy) throw new Error('backup_in_flight');
  busy = true;
  let keepCount = 0;
  try {
    const dbBytes = snapshotToBuffer(deps.dbPath, deps.spoolDir);
    const kek = readKekBytes();
    const blob = await encryptBundle({ kek, dbBytes }, {
      recoverySecret: deps.recoverySecret,
      vendorPub: deps.vendorPub,
    });

    const key = `escrow-${String(deps.now).padStart(14, '0')}-${randomUUID().slice(0, 8)}.bin`;
    await deps.dest.put(key, blob);

    const verifyBlob = await deps.dest.get(key);
    await decryptBundle(verifyBlob, { recoverySecret: deps.recoverySecret });

    const listed = await deps.dest.list();
    const snaps: Snapshot[] = listed.map((o) => ({ key: o.key, at: o.at }));
    const plan = planRetention(snaps, deps.now);
    await deps.dest.del(plan.remove.map((s) => s.key));

    keepCount = plan.keep.length;
    escrowStore.setStatus({
      at: new Date(deps.now).toISOString(),
      status: 'ok',
      error: null,
      count: keepCount,
    });

    return { key, removed: plan.remove.length };
  } catch (err) {
    escrowStore.setStatus({
      at: new Date(deps.now).toISOString(),
      status: 'error',
      error: String(err),
      count: keepCount,
    });
    throw err;
  } finally {
    busy = false;
  }
}

let tickHandle: ReturnType<typeof setInterval> | null = null;
let lastDataVersion: number | null = null;
let lastChangeAt = 0;
let lastBackupAt = 0;

const TICK_MS = 15000;

async function tick(): Promise<void> {
  try {
    const cfg = escrowStore.get();
    if (!cfg.enabled || !cfg.recoverySecret || !cfg.clientDest) return;

    const row = sqlite.query('PRAGMA data_version').get() as { data_version: number };
    const dv = row.data_version;
    const now = Date.now();

    if (cfg.vendorEnabled && !vendorPubkey()) {
      escrowStore.setStatus({ at: new Date(now).toISOString(), status: 'error', error: 'vendor_unavailable', count: 0 });
      return;
    }

    if (dv !== lastDataVersion) {
      lastChangeAt = now;
      lastDataVersion = dv;
    }

    const changedPending = lastChangeAt > lastBackupAt;
    const debounceElapsed = now - lastChangeAt >= config.escrowDebounceMs;
    const periodicElapsed = now - lastBackupAt >= config.escrowPeriodicMs;

    const shouldRun = !busy && ((changedPending && debounceElapsed) || periodicElapsed);
    if (!shouldRun) return;

    try {
      await runBackupOnce({
        dest: s3Dest(cfg.clientDest),
        dbPath: config.dbPath,
        recoverySecret: cfg.recoverySecret,
        vendorPub: cfg.vendorEnabled ? vendorPubkey() : null,
        now,
        spoolDir: config.escrowSpoolDir,
      });
      lastBackupAt = now;
    } catch {
      return;
    }
  } catch {
    return;
  }
}

export function startEscrowScheduler(): void {
  if (tickHandle) return;
  tickHandle = setInterval(tick, TICK_MS);
}

export function stopEscrowScheduler(): void {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
  busy = false;
  lastDataVersion = null;
  lastChangeAt = 0;
  lastBackupAt = 0;
}
