// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { eq, and, count, sql } from 'drizzle-orm';
import { db } from '../db';
import { users, userGroups, grants, userBlocks } from '../db/schema';
import type { Perm, PublicUser, Role, UserGrant, UserBlock } from '../types';
import { hashPassword } from '../auth/passwords';

type Row = typeof users.$inferSelect;

function toPublic(r: Row): PublicUser {
  return {
    username: r.username,
    role: r.role as Role,
    created: r.createdAt,
    lastLogin: r.lastLogin ?? undefined,
    active: r.active === 1,
    canShare: r.canShare === 1,
    groups: db
      .select({ groupId: userGroups.groupId })
      .from(userGroups)
      .where(eq(userGroups.username, r.username))
      .orderBy(userGroups.groupId)
      .all()
      .map((x) => x.groupId),
    grants: db
      .select({ bucketId: grants.bucketId, prefix: grants.prefix, perm: grants.perm })
      .from(grants)
      .where(and(eq(grants.subjectType, 'user'), eq(grants.subjectId, r.username)))
      .orderBy(grants.bucketId, grants.prefix)
      .all() as UserGrant[],
    blocks: db
      .select({ bucketId: userBlocks.bucketId, prefix: userBlocks.prefix })
      .from(userBlocks)
      .where(eq(userBlocks.username, r.username))
      .orderBy(userBlocks.bucketId, userBlocks.prefix)
      .all() as UserBlock[],
  };
}

export const usersStore = {
  raw(username: string): Row | null {
    return db.select().from(users).where(eq(users.username, username)).get() ?? null;
  },

  get(username: string): PublicUser | null {
    const r = this.raw(username);
    return r ? toPublic(r) : null;
  },

  list(): PublicUser[] {
    return db.select().from(users).orderBy(users.username).all().map(toPublic);
  },

  count(): number {
    return db.select({ n: count() }).from(users).get()?.n ?? 0;
  },

  async create(username: string, password: string, role: Role): Promise<PublicUser> {
    const passwordHash = await hashPassword(password);
    db.insert(users).values({
      username,
      passwordHash,
      role,
      tokenVersion: 1,
      grants: '{}',
      active: 1,
      createdAt: new Date().toISOString(),
    }).run();
    return this.get(username)!;
  },

  exists(username: string): boolean {
    return !!db.select({ username: users.username }).from(users).where(eq(users.username, username)).get();
  },

  setRole(username: string, role: Role): PublicUser | null {
    db.update(users).set({ role }).where(eq(users.username, username)).run();
    return this.get(username);
  },

  setCanShare(username: string, value: boolean): PublicUser | null {
    if (!this.exists(username)) return null;
    db.update(users).set({ canShare: value ? 1 : 0 }).where(eq(users.username, username)).run();
    return this.get(username);
  },

  /** Define/remove um allow direto do usuário (perm null remove). */
  setGrant(username: string, bucketId: string, prefix: string, perm: Perm | null): PublicUser | null {
    if (!this.exists(username)) return null;
    if (perm === null) {
      db.delete(grants)
        .where(and(
          eq(grants.subjectType, 'user'),
          eq(grants.subjectId, username),
          eq(grants.bucketId, bucketId),
          eq(grants.prefix, prefix),
        ))
        .run();
    } else {
      db.insert(grants)
        .values({ subjectType: 'user', subjectId: username, bucketId, prefix, perm })
        .onConflictDoUpdate({
          target: [grants.subjectType, grants.subjectId, grants.bucketId, grants.prefix],
          set: { perm },
        })
        .run();
    }
    return this.get(username);
  },

  /** Define/remove um deny (bloqueio) do usuário. */
  setBlock(username: string, bucketId: string, prefix: string, blocked: boolean): PublicUser | null {
    if (!this.exists(username)) return null;
    if (blocked) {
      db.insert(userBlocks).values({ username, bucketId, prefix }).onConflictDoNothing().run();
    } else {
      db.delete(userBlocks)
        .where(and(eq(userBlocks.username, username), eq(userBlocks.bucketId, bucketId), eq(userBlocks.prefix, prefix)))
        .run();
    }
    return this.get(username);
  },

  /** Adiciona/remove o usuário de um grupo. */
  setGroupMember(username: string, groupId: string, member: boolean): PublicUser | null {
    if (!this.exists(username)) return null;
    if (member) {
      db.insert(userGroups).values({ username, groupId }).onConflictDoNothing().run();
    } else {
      db.delete(userGroups)
        .where(and(eq(userGroups.username, username), eq(userGroups.groupId, groupId)))
        .run();
    }
    return this.get(username);
  },

  async setPassword(username: string, password: string): Promise<void> {
    const passwordHash = await hashPassword(password);
    db.update(users)
      .set({ passwordHash, tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.username, username))
      .run();
  },

  bumpVersion(username: string): void {
    db.update(users)
      .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.username, username))
      .run();
  },

  touchLogin(username: string): void {
    db.update(users).set({ lastLogin: new Date().toISOString() }).where(eq(users.username, username)).run();
  },

  remove(username: string): void {
    db.delete(users).where(eq(users.username, username)).run(); // cascade user_groups/user_blocks
    db.delete(grants).where(and(eq(grants.subjectType, 'user'), eq(grants.subjectId, username))).run(); // grants sem FK
  },
};
