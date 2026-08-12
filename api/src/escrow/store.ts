// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { escrowConfig } from '../db/schema';
import type { DestConfig } from './dest';

const ROW_ID = 'default';

export interface EscrowConfigRow {
  enabled: boolean;
  clientDest: DestConfig | null;
  vendorEnabled: boolean;
  recoverySecret: string | null;
  recoveryShown: boolean;
  lastBackupAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastCount: number;
}

const DEFAULT_ROW: EscrowConfigRow = {
  enabled: false,
  clientDest: null,
  vendorEnabled: false,
  recoverySecret: null,
  recoveryShown: false,
  lastBackupAt: null,
  lastStatus: null,
  lastError: null,
  lastCount: 0,
};

export const escrowStore = {
  get(): EscrowConfigRow {
    const row = db.select().from(escrowConfig).where(eq(escrowConfig.id, ROW_ID)).get();
    if (!row) return { ...DEFAULT_ROW };
    return {
      enabled: row.enabled === 1,
      clientDest: row.clientDest ? (JSON.parse(row.clientDest) as DestConfig) : null,
      vendorEnabled: row.vendorEnabled === 1,
      recoverySecret: row.recoverySecret ?? null,
      recoveryShown: row.recoveryShown === 1,
      lastBackupAt: row.lastBackupAt ?? null,
      lastStatus: row.lastStatus ?? null,
      lastError: row.lastError ?? null,
      lastCount: row.lastCount,
    };
  },

  setConfig(p: { enabled?: boolean; clientDest?: DestConfig | null; vendorEnabled?: boolean }): void {
    const current = escrowStore.get();
    const next = {
      enabled: p.enabled ?? current.enabled,
      clientDest: p.clientDest !== undefined ? p.clientDest : current.clientDest,
      vendorEnabled: p.vendorEnabled ?? current.vendorEnabled,
    };
    const now = new Date().toISOString();
    db.insert(escrowConfig).values({
      id: ROW_ID,
      enabled: next.enabled ? 1 : 0,
      clientDest: next.clientDest ? JSON.stringify(next.clientDest) : null,
      vendorEnabled: next.vendorEnabled ? 1 : 0,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: escrowConfig.id,
      set: {
        enabled: next.enabled ? 1 : 0,
        clientDest: next.clientDest ? JSON.stringify(next.clientDest) : null,
        vendorEnabled: next.vendorEnabled ? 1 : 0,
        updatedAt: now,
      },
    }).run();
  },

  setRecovery(secret: string): void {
    const now = new Date().toISOString();
    db.insert(escrowConfig).values({
      id: ROW_ID,
      recoverySecret: secret,
      recoveryShown: 0,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: escrowConfig.id,
      set: { recoverySecret: secret, recoveryShown: 0, updatedAt: now },
    }).run();
  },

  markShown(): void {
    const now = new Date().toISOString();
    db.insert(escrowConfig).values({
      id: ROW_ID,
      recoveryShown: 1,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: escrowConfig.id,
      set: { recoveryShown: 1, updatedAt: now },
    }).run();
  },

  setStatus(s: { at: string; status: string; error?: string | null; count: number }): void {
    const now = new Date().toISOString();
    db.insert(escrowConfig).values({
      id: ROW_ID,
      lastBackupAt: s.at,
      lastStatus: s.status,
      lastError: s.error ?? null,
      lastCount: s.count,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: escrowConfig.id,
      set: {
        lastBackupAt: s.at, lastStatus: s.status, lastError: s.error ?? null, lastCount: s.count, updatedAt: now,
      },
    }).run();
  },
};
