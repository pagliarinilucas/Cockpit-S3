// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { eq, and, count } from 'drizzle-orm';
import { db } from '../db';
import { groups, userGroups, grants } from '../db/schema';
import type { Perm } from '../types';

export interface GroupGrant { bucketId: string; prefix: string; perm: Perm }
export interface PublicGroup { id: string; name: string; created: string; members: number; grants: GroupGrant[] }

function toPublic(g: { id: string; name: string; createdAt: string }): PublicGroup {
  const members = db.select({ n: count() }).from(userGroups).where(eq(userGroups.groupId, g.id)).get()?.n ?? 0;
  const grantRows = db
    .select({ bucketId: grants.bucketId, prefix: grants.prefix, perm: grants.perm })
    .from(grants)
    .where(and(eq(grants.subjectType, 'group'), eq(grants.subjectId, g.id)))
    .orderBy(grants.bucketId, grants.prefix)
    .all() as GroupGrant[];
  return { id: g.id, name: g.name, created: g.createdAt, members, grants: grantRows };
}

export const groupsStore = {
  list(): PublicGroup[] {
    return db.select().from(groups).orderBy(groups.name).all().map(toPublic);
  },
  get(id: string): PublicGroup | null {
    const g = db.select().from(groups).where(eq(groups.id, id)).get();
    return g ? toPublic(g) : null;
  },
  exists(id: string): boolean {
    return !!db.select({ id: groups.id }).from(groups).where(eq(groups.id, id)).get();
  },
  nameExists(name: string): boolean {
    return !!db.select({ id: groups.id }).from(groups).where(eq(groups.name, name)).get();
  },
  create(name: string): PublicGroup {
    const id = 'g' + crypto.randomUUID().replace(/-/g, '').slice(0, 11);
    db.insert(groups).values({ id, name, createdAt: new Date().toISOString() }).run();
    return this.get(id)!;
  },
  rename(id: string, name: string): void {
    db.update(groups).set({ name }).where(eq(groups.id, id)).run();
  },
  remove(id: string): void {
    db.delete(groups).where(eq(groups.id, id)).run(); // cascade user_groups
    db.delete(grants).where(and(eq(grants.subjectType, 'group'), eq(grants.subjectId, id))).run(); // grants tem PK polimórfica, sem FK
  },
  setGrant(id: string, bucketId: string, prefix: string, perm: Perm | null): void {
    if (perm === null) {
      db.delete(grants)
        .where(and(
          eq(grants.subjectType, 'group'),
          eq(grants.subjectId, id),
          eq(grants.bucketId, bucketId),
          eq(grants.prefix, prefix),
        ))
        .run();
      return;
    }
    db.insert(grants)
      .values({ subjectType: 'group', subjectId: id, bucketId, prefix, perm })
      .onConflictDoUpdate({
        target: [grants.subjectType, grants.subjectId, grants.bucketId, grants.prefix],
        set: { perm },
      })
      .run();
  },
};
