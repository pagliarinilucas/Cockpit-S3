import { db } from '../db';
import type { Perm } from '../types';

export interface GroupGrant { bucketId: string; prefix: string; perm: Perm }
export interface PublicGroup { id: string; name: string; created: string; members: number; grants: GroupGrant[] }

function newId(): string { return 'g' + crypto.randomUUID().replace(/-/g, '').slice(0, 11); }

function grantsOf(groupId: string): GroupGrant[] {
  return db.query("SELECT bucket_id AS bucketId, prefix, perm FROM grants WHERE subject_type='group' AND subject_id = ? ORDER BY bucket_id, prefix")
    .all(groupId) as GroupGrant[];
}

export const groupsStore = {
  list(): PublicGroup[] {
    const groups = db.query('SELECT id, name, created_at FROM groups ORDER BY name').all() as { id: string; name: string; created_at: string }[];
    return groups.map((g) => ({
      id: g.id, name: g.name, created: g.created_at,
      members: (db.query('SELECT COUNT(*) AS n FROM user_groups WHERE group_id = ?').get(g.id) as { n: number }).n,
      grants: grantsOf(g.id),
    }));
  },
  get(id: string): PublicGroup | null {
    const g = db.query('SELECT id, name, created_at FROM groups WHERE id = ?').get(id) as { id: string; name: string; created_at: string } | null;
    if (!g) return null;
    return {
      id: g.id, name: g.name, created: g.created_at,
      members: (db.query('SELECT COUNT(*) AS n FROM user_groups WHERE group_id = ?').get(g.id) as { n: number }).n,
      grants: grantsOf(g.id),
    };
  },
  exists(id: string): boolean { return !!db.query('SELECT 1 FROM groups WHERE id = ?').get(id); },
  nameExists(name: string): boolean { return !!db.query('SELECT 1 FROM groups WHERE name = ?').get(name); },
  create(name: string): PublicGroup {
    const id = newId();
    db.query('INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)').run(id, name, new Date().toISOString());
    return this.get(id)!;
  },
  rename(id: string, name: string): void {
    db.query('UPDATE groups SET name = ? WHERE id = ?').run(name, id);
  },
  remove(id: string): void {
    db.query('DELETE FROM groups WHERE id = ?').run(id);                                 // cascade user_groups
    db.query("DELETE FROM grants WHERE subject_type='group' AND subject_id = ?").run(id); // grants has no FK
  },
  setGrant(id: string, bucketId: string, prefix: string, perm: Perm | null): void {
    if (perm === null) {
      db.query("DELETE FROM grants WHERE subject_type='group' AND subject_id=? AND bucket_id=? AND prefix=?").run(id, bucketId, prefix);
    } else {
      db.query(`INSERT INTO grants (subject_type, subject_id, bucket_id, prefix, perm) VALUES ('group', ?, ?, ?, ?)
                ON CONFLICT(subject_type, subject_id, bucket_id, prefix) DO UPDATE SET perm = excluded.perm`)
        .run(id, bucketId, prefix, perm);
    }
  },
};
