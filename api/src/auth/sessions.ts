import { db } from '../db';
import { config } from '../config';
import { hashRefresh, newRefreshToken } from './tokens';

interface SessionRow {
  id: string;
  family_id: string;
  username: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  rotated_to: string | null;
  revoked: number;
  user_agent: string | null;
}

export type RefreshResult =
  | { ok: true; username: string; token: string; familyId: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'revoked' | 'reuse' };

function insert(username: string, familyId: string, token: string, userAgent: string | null) {
  const now = Date.now();
  db.query(
    `INSERT INTO sessions (id, family_id, username, token_hash, created_at, expires_at, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    familyId,
    username,
    hashRefresh(token),
    new Date(now).toISOString(),
    new Date(now + config.refreshTtl * 1000).toISOString(),
    userAgent,
  );
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
    const hash = hashRefresh(presented);
    const row = db.query('SELECT * FROM sessions WHERE token_hash = ?').get(hash) as SessionRow | null;
    if (!row) return { ok: false, reason: 'invalid' };

    if (row.revoked === 1) {
      this.revokeFamily(row.family_id);
      return { ok: false, reason: 'revoked' };
    }
    if (row.used_at) {
      // Token already rotated once → almost certainly stolen. Burn the family.
      this.revokeFamily(row.family_id);
      return { ok: false, reason: 'reuse' };
    }
    if (Date.parse(row.expires_at) < Date.now()) {
      this.revokeFamily(row.family_id);
      return { ok: false, reason: 'expired' };
    }

    const next = newRefreshToken();
    const tx = db.transaction(() => {
      db.query('UPDATE sessions SET used_at = ?, rotated_to = ? WHERE id = ?')
        .run(new Date().toISOString(), '(pending)', row.id);
      insert(row.username, row.family_id, next, userAgent);
      // link rotated_to to the freshly inserted row in this family
      const child = db.query(
        'SELECT id FROM sessions WHERE family_id = ? ORDER BY created_at DESC LIMIT 1',
      ).get(row.family_id) as { id: string };
      db.query('UPDATE sessions SET rotated_to = ? WHERE id = ?').run(child.id, row.id);
    });
    tx();
    return { ok: true, username: row.username, token: next, familyId: row.family_id };
  },

  /** Revoke the session matching a refresh token (logout of this device). */
  revokeByToken(presented: string): void {
    const hash = hashRefresh(presented);
    const row = db.query('SELECT family_id FROM sessions WHERE token_hash = ?').get(hash) as { family_id: string } | null;
    if (row) this.revokeFamily(row.family_id);
  },

  revokeFamily(familyId: string): void {
    db.query('UPDATE sessions SET revoked = 1 WHERE family_id = ?').run(familyId);
  },

  revokeAllForUser(username: string): void {
    db.query('UPDATE sessions SET revoked = 1 WHERE username = ?').run(username);
  },

  /** Housekeeping: drop expired/revoked rows. */
  prune(): void {
    db.query("DELETE FROM sessions WHERE revoked = 1 OR expires_at < ?").run(new Date().toISOString());
  },
};
