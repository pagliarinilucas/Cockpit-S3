import { db } from '../db';
import type { Perm, PublicUser, Role, UserRow } from '../types';
import { hashPassword } from '../auth/passwords';

function toPublic(r: UserRow): PublicUser {
  let grants: Record<string, Perm | null> = {};
  try { grants = JSON.parse(r.grants) as Record<string, Perm | null>; } catch { /* keep {} */ }
  return {
    username: r.username,
    role: r.role,
    created: r.created_at,
    lastLogin: r.last_login ?? undefined,
    active: r.active === 1,
    grants,
  };
}

export const usersStore = {
  raw(username: string): UserRow | null {
    return db.query('SELECT * FROM users WHERE username = ?').get(username) as UserRow | null;
  },

  get(username: string): PublicUser | null {
    const r = this.raw(username);
    return r ? toPublic(r) : null;
  },

  list(): PublicUser[] {
    const rows = db.query('SELECT * FROM users ORDER BY username').all() as UserRow[];
    return rows.map(toPublic);
  },

  count(): number {
    return (db.query('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  },

  async create(username: string, password: string, role: Role): Promise<PublicUser> {
    const hash = await hashPassword(password);
    db.query(
      `INSERT INTO users (username, password_hash, role, token_version, grants, active, created_at)
       VALUES (?, ?, ?, 1, '{}', 1, ?)`,
    ).run(username, hash, role, new Date().toISOString());
    return this.get(username)!;
  },

  exists(username: string): boolean {
    return !!db.query('SELECT 1 FROM users WHERE username = ?').get(username);
  },

  setRole(username: string, role: Role): PublicUser | null {
    db.query('UPDATE users SET role = ? WHERE username = ?').run(role, username);
    return this.get(username);
  },

  setGrant(username: string, bucketId: string, perm: Perm | null): PublicUser | null {
    const r = this.raw(username);
    if (!r) return null;
    const grants: Record<string, Perm | null> = JSON.parse(r.grants || '{}');
    if (perm === null) delete grants[bucketId];
    else grants[bucketId] = perm;
    db.query('UPDATE users SET grants = ? WHERE username = ?').run(JSON.stringify(grants), username);
    return this.get(username);
  },

  async setPassword(username: string, password: string): Promise<void> {
    const hash = await hashPassword(password);
    // changing the password bumps token_version → kills all existing access tokens
    db.query('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE username = ?')
      .run(hash, username);
  },

  /** Bump version to invalidate every outstanding access token for the user. */
  bumpVersion(username: string): void {
    db.query('UPDATE users SET token_version = token_version + 1 WHERE username = ?').run(username);
  },

  touchLogin(username: string): void {
    db.query('UPDATE users SET last_login = ? WHERE username = ?').run(new Date().toISOString(), username);
  },

  remove(username: string): void {
    db.query('DELETE FROM users WHERE username = ?').run(username);
  },

  /** Effective permission for a user on a bucket (admins implicitly own everything). */
  permFor(username: string, bucketId: string): Perm | null {
    const r = this.raw(username);
    if (!r) return null;
    if (r.role === 'admin') return 'owner';
    const grants: Record<string, Perm | null> = JSON.parse(r.grants || '{}');
    return grants[bucketId] ?? null;
  },
};
