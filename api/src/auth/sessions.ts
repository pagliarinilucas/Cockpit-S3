// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { eq, or, lt } from 'drizzle-orm';
import { db } from '../db';
import { sessions as sessionsTable } from '../db/schema';
import { config } from '../config';
import { hashRefresh, newRefreshToken } from './tokens';

export type RefreshResult =
  | { ok: true; username: string; token: string; familyId: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'revoked' | 'reuse' };

/** Insere uma nova sessão (linha de refresh) e devolve o id gerado. */
function insert(username: string, familyId: string, token: string, userAgent: string | null): string {
  const id = crypto.randomUUID();
  const now = Date.now();
  db.insert(sessionsTable).values({
    id,
    familyId,
    username,
    tokenHash: hashRefresh(token),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + config.refreshTtl * 1000).toISOString(),
    userAgent,
  }).run();
  return id;
}

export const sessions = {
  /** Start a brand-new rotation family (called at login). Returns the raw refresh token. */
  start(username: string, userAgent: string | null): string {
    const token = newRefreshToken();
    insert(username, crypto.randomUUID(), token, userAgent);
    return token;
  },

  /**
   * Rotate a refresh token. Implements reuse detection:
   * presenting an already-rotated token revokes the whole family and signals 'reuse'.
   */
  rotate(presented: string, userAgent: string | null): RefreshResult {
    const row = db.select().from(sessionsTable).where(eq(sessionsTable.tokenHash, hashRefresh(presented))).get();
    if (!row) return { ok: false, reason: 'invalid' };

    if (row.revoked === 1) {
      this.revokeFamily(row.familyId);
      return { ok: false, reason: 'revoked' };
    }
    if (row.usedAt) {
      // Token already rotated once → almost certainly stolen. Burn the family.
      this.revokeFamily(row.familyId);
      return { ok: false, reason: 'reuse' };
    }
    if (Date.parse(row.expiresAt) < Date.now()) {
      this.revokeFamily(row.familyId);
      return { ok: false, reason: 'expired' };
    }

    const next = newRefreshToken();
    const now = Date.now();
    const childId = crypto.randomUUID();
    db.transaction((tx) => {
      tx.update(sessionsTable).set({ usedAt: new Date(now).toISOString(), rotatedTo: childId }).where(eq(sessionsTable.id, row.id)).run();
      tx.insert(sessionsTable).values({
        id: childId,
        familyId: row.familyId,
        username: row.username,
        tokenHash: hashRefresh(next),
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + config.refreshTtl * 1000).toISOString(),
        userAgent,
      }).run();
    });
    return { ok: true, username: row.username, token: next, familyId: row.familyId };
  },

  /** Revoke the session matching a refresh token (logout of this device). */
  revokeByToken(presented: string): void {
    const row = db.select({ familyId: sessionsTable.familyId }).from(sessionsTable).where(eq(sessionsTable.tokenHash, hashRefresh(presented))).get();
    if (row) this.revokeFamily(row.familyId);
  },

  revokeFamily(familyId: string): void {
    db.update(sessionsTable).set({ revoked: 1 }).where(eq(sessionsTable.familyId, familyId)).run();
  },

  revokeAllForUser(username: string): void {
    db.update(sessionsTable).set({ revoked: 1 }).where(eq(sessionsTable.username, username)).run();
  },

  /** Housekeeping: drop expired/revoked rows. */
  prune(): void {
    db.delete(sessionsTable)
      .where(or(eq(sessionsTable.revoked, 1), lt(sessionsTable.expiresAt, new Date().toISOString())))
      .run();
  },
};
