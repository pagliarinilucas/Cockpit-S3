import { db } from '../db';
import type { Perm, Role } from '../types';

export interface Allow { prefix: string; perm: Perm }
export interface Access { all: boolean; allows: Allow[]; denies: string[] }

const RANK: Record<Perm, number> = { 'read-only': 1, 'read-write': 2, 'owner': 3 };
const BY_RANK: (Perm | null)[] = [null, 'read-only', 'read-write', 'owner'];

/** Permissão efetiva para `key`. Deny absoluto vence; senão maior allow cujo prefixo cobre a chave. */
export function resolvePerm(allows: Allow[], denies: string[], key: string): Perm | null {
  if (denies.some((d) => key.startsWith(d))) return null;
  let best = 0;
  for (const a of allows) if (key.startsWith(a.prefix)) best = Math.max(best, RANK[a.perm]);
  return BY_RANK[best] ?? null;
}

/** Mostra a pasta se for coberta por, ou ancestral de, algum allow — e não estiver sob deny. */
export function folderVisible(allows: Allow[], denies: string[], folderKey: string): boolean {
  if (denies.some((d) => folderKey.startsWith(d))) return false;
  return allows.some((a) => folderKey.startsWith(a.prefix) || a.prefix.startsWith(folderKey));
}

/** Maior perm em qualquer lugar do bucket, ignorando allows inteiramente sob um deny. */
export function maxBucketPerm(allows: Allow[], denies: string[]): Perm | null {
  let best = 0;
  for (const a of allows) if (!denies.some((d) => a.prefix.startsWith(d))) best = Math.max(best, RANK[a.perm]);
  return BY_RANK[best] ?? null;
}

interface Subject { username: string; role: Role }

export const perms = {
  /** Conjunto de acesso de `user` em `bucketId`, ou null se ele não tem nenhum allow lá. */
  access(user: Subject, bucketId: string): Access | null {
    if (user.role === 'admin') return { all: true, allows: [], denies: [] };
    const allows: Allow[] = [
      ...(db.query("SELECT prefix, perm FROM grants WHERE subject_type='user' AND subject_id=? AND bucket_id=?")
        .all(user.username, bucketId) as Allow[]),
      ...(db.query(`SELECT g.prefix AS prefix, g.perm AS perm FROM grants g
                    JOIN user_groups ug ON ug.group_id = g.subject_id
                    WHERE g.subject_type='group' AND ug.username=? AND g.bucket_id=?`)
        .all(user.username, bucketId) as Allow[]),
    ];
    if (allows.length === 0) return null;
    const denies = (db.query('SELECT prefix FROM user_blocks WHERE username=? AND bucket_id=?')
      .all(user.username, bucketId) as { prefix: string }[]).map((d) => d.prefix);
    return { all: false, allows, denies };
  },
  permForKey(a: Access, key: string): Perm | null {
    return a.all ? 'owner' : resolvePerm(a.allows, a.denies, key);
  },
  canRead(a: Access, key: string): boolean {
    return this.permForKey(a, key) !== null;
  },
  canWrite(a: Access, key: string): boolean {
    const p = this.permForKey(a, key);
    return p === 'owner' || p === 'read-write';
  },
  folderVisible(a: Access, key: string): boolean {
    return a.all ? true : folderVisible(a.allows, a.denies, key);
  },
  /** True se o usuário tem QUALQUER acesso efetivo no bucket (autoriza listagem/stats/search). */
  hasBucketAccess(a: Access): boolean {
    return a.all || maxBucketPerm(a.allows, a.denies) !== null;
  },
  /** Maior perm do usuário no bucket (badge). null = bucket não aparece. */
  bucketPermFor(user: Subject, bucketId: string): Perm | null {
    if (user.role === 'admin') return 'owner';
    const a = this.access(user, bucketId);
    return a ? maxBucketPerm(a.allows, a.denies) : null;
  },
};
