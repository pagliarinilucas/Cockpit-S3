// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { Elysia, t } from 'elysia';
import { authDerive, requireAdmin } from '../auth/guard';
import { clustersStore } from './store';
import { garageAdmin, type AdminCreds } from '../garage/admin';
import { s3 } from '../storage/s3';
import { audit } from '../audit/store';
import type { ClusterFull } from '../types';

function creds(c: ClusterFull): AdminCreds { return { endpoint: c.adminEndpoint, token: c.adminToken }; }

/** Configura o client S3 da key interna do cluster (para navegar objetos). */
export function configureClusterS3(c: ClusterFull): void {
  if (c.internalKeyId && c.internalSecret) {
    s3.configureSource(c.id, { endpoint: c.s3Endpoint, region: c.region, accessKey: c.internalKeyId, secretKey: c.internalSecret });
  }
}

export const clusterRoutes = new Elysia({ prefix: '/api/clusters' })
  .use(authDerive)
  .guard({ beforeHandle: requireAdmin }, (app) => app

    .get('/', () => clustersStore.list())

    .post('/', async ({ body, set, user }) => {
      const created = clustersStore.create(body);
      // cria a key interna via Admin API
      try {
        const key = await garageAdmin(creds(created)).createKey(`cockpit-${created.name}`);
        clustersStore.setInternalKey(created.id, key.accessKeyId, key.secretAccessKey);
      } catch (e) {
        clustersStore.remove(created.id);
        set.status = 502; return { error: `falha ao criar key interna: ${String((e as Error).message)}` };
      }
      const fresh = clustersStore.getFull(created.id)!;
      configureClusterS3(fresh);
      audit.log('bucket', user!.username, '—', `criou cluster ${created.name}`);
      set.status = 201; return clustersStore.get(created.id);
    }, { body: t.Object({ name: t.String({ minLength: 1 }), adminEndpoint: t.String({ minLength: 1 }), adminToken: t.String({ minLength: 1 }), s3Endpoint: t.String({ minLength: 1 }), region: t.Optional(t.String()) }) })

    .put('/:id', async ({ params, body, set }) => {
      const existing = clustersStore.getFull(params.id);
      if (!existing) { set.status = 404; return { error: 'not_found' }; }
      const adminToken = body.adminToken || existing.adminToken;
      const updated = clustersStore.update(params.id, { ...body, adminToken })!;
      configureClusterS3(updated);
      return clustersStore.get(params.id);
    }, { body: t.Object({ name: t.String({ minLength: 1 }), adminEndpoint: t.String({ minLength: 1 }), adminToken: t.Optional(t.String()), s3Endpoint: t.String({ minLength: 1 }), region: t.Optional(t.String()) }) })

    .delete('/:id', async ({ params, set, user }) => {
      const c = clustersStore.getFull(params.id);
      if (!c) { set.status = 404; return { error: 'not_found' }; }
      if (c.internalKeyId) { try { await garageAdmin(creds(c)).deleteKey(c.internalKeyId); } catch { /* best-effort */ } }
      s3.removeOne(params.id);
      clustersStore.remove(params.id);
      audit.log('bucket', user!.username, '—', `removeu cluster ${c.name}`);
      return { ok: true };
    })

    // ── admin ops (reaproveita garage/admin.ts) ──
    .get('/:id/cluster', async ({ params, set }) => {
      const c = clustersStore.getFull(params.id); if (!c) { set.status = 404; return { error: 'not_found' }; }
      try { return await garageAdmin(creds(c)).cluster(); } catch (e) { set.status = 502; return { error: String((e as Error).message) }; }
    })
    .get('/:id/buckets', async ({ params, set }) => {
      const c = clustersStore.getFull(params.id); if (!c) { set.status = 404; return { error: 'not_found' }; }
      const g = garageAdmin(creds(c));
      try { const list = await g.listBuckets(); const infos = await Promise.all(list.map((b) => g.bucketInfo(b.id)));
        return infos.map((i) => ({ id: i.id, aliases: i.globalAliases, objects: i.objects, bytes: i.bytes, quotas: i.quotas, keys: i.keys })); }
      catch (e) { set.status = 502; return { error: String((e as Error).message) }; }
    })
    .post('/:id/buckets', async ({ params, body, set, user }) => {
      const c = clustersStore.getFull(params.id); if (!c) { set.status = 404; return { error: 'not_found' }; }
      try { const r = await garageAdmin(creds(c)).createBucket(body.alias); audit.log('bucket', user!.username, '—', `cluster ${c.name}: bucket ${body.alias}`); set.status = 201; return r; }
      catch (e) { set.status = 502; return { error: String((e as Error).message) }; }
    }, { body: t.Object({ alias: t.String({ minLength: 1 }) }) })
    .delete('/:id/buckets/:bucketId', async ({ params, set, user }) => {
      const c = clustersStore.getFull(params.id); if (!c) { set.status = 404; return { error: 'not_found' }; }
      try { await garageAdmin(creds(c)).deleteBucket(params.bucketId); audit.log('bucket', user!.username, '—', `cluster ${c.name}: removeu bucket`); return { ok: true }; }
      catch (e) { set.status = 502; return { error: String((e as Error).message) }; }
    })
    .put('/:id/buckets/:bucketId/quotas', async ({ params, body, set }) => {
      const c = clustersStore.getFull(params.id); if (!c) { set.status = 404; return { error: 'not_found' }; }
      try { return await garageAdmin(creds(c)).setQuotas(params.bucketId, body.maxSize, body.maxObjects); } catch (e) { set.status = 502; return { error: String((e as Error).message) }; }
    }, { body: t.Object({ maxSize: t.Union([t.Number(), t.Null()]), maxObjects: t.Union([t.Number(), t.Null()]) }) })
    .get('/:id/keys', async ({ params, set }) => {
      const c = clustersStore.getFull(params.id); if (!c) { set.status = 404; return { error: 'not_found' }; }
      const g = garageAdmin(creds(c));
      try { const list = await g.listKeys(); const infos = await Promise.all(list.map((k) => g.keyInfo(k.id)));
        return infos.map((i) => ({ id: i.accessKeyId, name: i.name, created: i.created, expired: i.expired, buckets: i.buckets.map((b) => ({ id: b.id, aliases: b.globalAliases, permissions: b.permissions })) })); }
      catch (e) { set.status = 502; return { error: String((e as Error).message) }; }
    })
    .post('/:id/keys', async ({ params, body, set, user }) => {
      const c = clustersStore.getFull(params.id); if (!c) { set.status = 404; return { error: 'not_found' }; }
      try { const r = await garageAdmin(creds(c)).createKey(body.name); audit.log('key', user!.username, '—', `cluster ${c.name}: key ${body.name}`); set.status = 201; return r; }
      catch (e) { set.status = 502; return { error: String((e as Error).message) }; }
    }, { body: t.Object({ name: t.String({ minLength: 1 }) }) })
    .delete('/:id/keys/:keyId', async ({ params, set, user }) => {
      const c = clustersStore.getFull(params.id); if (!c) { set.status = 404; return { error: 'not_found' }; }
      try { await garageAdmin(creds(c)).deleteKey(params.keyId); audit.log('key', user!.username, '—', `cluster ${c.name}: removeu key`); return { ok: true }; }
      catch (e) { set.status = 502; return { error: String((e as Error).message) }; }
    })
    .put('/:id/keys/:keyId/buckets/:bucketId', async ({ params, body, set }) => {
      const c = clustersStore.getFull(params.id); if (!c) { set.status = 404; return { error: 'not_found' }; }
      try { await garageAdmin(creds(c)).setBucketKeyPerm(params.bucketId, params.keyId, body); return { ok: true }; }
      catch (e) { set.status = 502; return { error: String((e as Error).message) }; }
    }, { body: t.Object({ read: t.Boolean(), write: t.Boolean(), owner: t.Boolean() }) }),
  );
