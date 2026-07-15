// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { clusters } from '../db/schema';
import type { ClusterFull, ClusterInput, ClusterPublic } from '../types';

type Row = typeof clusters.$inferSelect;

function full(r: Row): ClusterFull {
  return {
    id: r.id, name: r.name, adminEndpoint: r.adminEndpoint, adminToken: r.adminToken,
    s3Endpoint: r.s3Endpoint, region: r.region, internalKeyId: r.internalKeyId,
    internalSecret: r.internalSecret, createdAt: r.createdAt,
  };
}
function pub(c: ClusterFull): ClusterPublic {
  return { id: c.id, name: c.name, adminEndpoint: c.adminEndpoint, s3Endpoint: c.s3Endpoint, region: c.region, adminConfigured: !!c.adminToken, createdAt: c.createdAt };
}

export const clustersStore = {
  listFull(): ClusterFull[] { return db.select().from(clusters).orderBy(clusters.createdAt).all().map(full); },
  list(): ClusterPublic[] { return this.listFull().map(pub); },
  getFull(id: string): ClusterFull | null { const r = db.select().from(clusters).where(eq(clusters.id, id)).get(); return r ? full(r) : null; },
  get(id: string): ClusterPublic | null { const c = this.getFull(id); return c ? pub(c) : null; },
  exists(id: string): boolean { return !!db.select({ id: clusters.id }).from(clusters).where(eq(clusters.id, id)).get(); },
  create(input: ClusterInput): ClusterFull {
    const id = 'k' + crypto.randomUUID().replace(/-/g, '').slice(0, 11);
    db.insert(clusters).values({
      id, name: input.name, adminEndpoint: input.adminEndpoint, adminToken: input.adminToken,
      s3Endpoint: input.s3Endpoint, region: input.region || 'garage', createdAt: new Date().toISOString(),
    }).run();
    return this.getFull(id)!;
  },
  update(id: string, input: ClusterInput): ClusterFull | null {
    if (!this.exists(id)) return null;
    db.update(clusters).set({
      name: input.name, adminEndpoint: input.adminEndpoint, adminToken: input.adminToken,
      s3Endpoint: input.s3Endpoint, region: input.region || 'garage',
    }).where(eq(clusters.id, id)).run();
    return this.getFull(id);
  },
  setInternalKey(id: string, keyId: string, secret: string): void {
    db.update(clusters).set({ internalKeyId: keyId, internalSecret: secret }).where(eq(clusters.id, id)).run();
  },
  remove(id: string): void { db.delete(clusters).where(eq(clusters.id, id)).run(); },
};
