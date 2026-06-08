import { db } from '../db';
import type { Perm, PublicUser, Role, UserGrant, UserBlock, UserRow } from '../types';
import { hashPassword } from '../auth/passwords';

function toPublic(r: UserRow): PublicUser {
  return {
    username: r.username,
    role: r.role,
    created: r.created_at,
    lastLogin: r.last_login ?? undefined,
    active: r.active === 1,
    groups: (db.query('SELECT group_id FROM user_groups WHERE username = ? ORDER BY group_id').all(r.username) as { group_id: string }[]).map((x) => x.group_id),
    grants: db.query("SELECT bucket_id AS bucketId, prefix, perm FROM grants WHERE subject_type='user' AND subject_id = ? ORDER BY bucket_id, prefix").all(r.username) as UserGrant[],
    blocks: db.query('SELECT bucket_id AS bucketId, prefix FROM user_blocks WHERE username = ? ORDER BY bucket_id, prefix').all(r.username) as UserBlock[],
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

  /** Define/remove um allow direto do usuário (perm null remove). */
  setGrant(username: string, bucketId: string, prefix: string, perm: Perm | null): PublicUser | null {
    if (!this.exists(username)) return null;
    if (perm === null) {
      db.query("DELETE FROM grants WHERE subject_type='user' AND subject_id=? AND bucket_id=? AND prefix=?").run(username, bucketId, prefix);
    } else {
      db.query(`INSERT INTO grants (subject_type, subject_id, bucket_id, prefix, perm) VALUES ('user', ?, ?, ?, ?)
                ON CONFLICT(subject_type, subject_id, bucket_id, prefix) DO UPDATE SET perm = excluded.perm`)
        .run(username, bucketId, prefix, perm);
    }
    return this.get(username);
  },

  /** Define/remove um deny (bloqueio) do usuário. */
  setBlock(username: string, bucketId: string, prefix: string, blocked: boolean): PublicUser | null {
    if (!this.exists(username)) return null;
    if (blocked) db.query('INSERT OR IGNORE INTO user_blocks (username, bucket_id, prefix) VALUES (?, ?, ?)').run(username, bucketId, prefix);
    else db.query('DELETE FROM user_blocks WHERE username=? AND bucket_id=? AND prefix=?').run(username, bucketId, prefix);
    return this.get(username);
  },

  /** Adiciona/remove o usuário de um grupo. */
  setGroupMember(username: string, groupId: string, member: boolean): PublicUser | null {
    if (!this.exists(username)) return null;
    if (member) db.query('INSERT OR IGNORE INTO user_groups (username, group_id) VALUES (?, ?)').run(username, groupId);
    else db.query('DELETE FROM user_groups WHERE username=? AND group_id=?').run(username, groupId);
    return this.get(username);
  },

  async setPassword(username: string, password: string): Promise<void> {
    const hash = await hashPassword(password);
    db.query('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE username = ?')
      .run(hash, username);
  },

  bumpVersion(username: string): void {
    db.query('UPDATE users SET token_version = token_version + 1 WHERE username = ?').run(username);
  },

  touchLogin(username: string): void {
    db.query('UPDATE users SET last_login = ? WHERE username = ?').run(new Date().toISOString(), username);
  },

  remove(username: string): void {
    db.query('DELETE FROM users WHERE username = ?').run(username);                        // cascade user_groups/user_blocks
    db.query("DELETE FROM grants WHERE subject_type='user' AND subject_id = ?").run(username); // grants has no FK
  },
};
