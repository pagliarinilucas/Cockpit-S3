import { Elysia, t } from 'elysia';
import { authDerive, requireUser } from '../auth/guard';
import { connectionsStore } from '../connections/store';
import { audit } from '../audit/store';
import { s3 } from './s3';
import { perms } from '../auth/permissions';
import type { Perm } from '../types';
import { clustersStore } from '../clusters/store';
import { garageAdmin } from '../garage/admin';
import { isCluster, ensureClusterBucketAccess, revokeClusterBucketAccess } from '../clusters/access';
import { bucketAliasStore } from '../buckets/store';
import { mayDeleteBucket } from '../buckets/guard';

const norm = (p: string) => (p ? (p.endsWith('/') ? p : p + '/') : '');

// short-lived cache for computed bucket stats; keyed by user (usage is now user-scoped).
const statsCache = new Map<string, { at: number; used: number; objects: number; truncated: boolean }>();
const STATS_TTL = 120_000;   // 2 min

/** Bucket ids are composite: `<connectionId>:<bucketName>`. */
function parse(id: string): { cid: string; bucket: string } | null {
  const i = id.indexOf(':');
  if (i <= 0) return null;
  return { cid: id.slice(0, i), bucket: id.slice(i + 1) };
}

/** Cluster buckets precisam da key interna liberada (lazy) antes de qualquer op S3. No-op para conexões. */
async function ensureSource(ref: { cid: string; bucket: string }): Promise<void> {
  if (isCluster(ref.cid)) await ensureClusterBucketAccess(ref.cid, ref.bucket);
}

export const storageRoutes = new Elysia({ prefix: '/api' })
  .use(authDerive)
  .guard({ beforeHandle: requireUser }, (app) => app

    // list buckets the caller can reach (any grant in the bucket)
    .get('/buckets', async ({ user, set }) => {
      if (!s3.hasAny()) { set.status = 503; return { error: 's3_not_configured' }; }
      const out: { id: string; name: string; connection: string; region: string; perm: Perm; alias?: string }[] = [];
      for (const conn of connectionsStore.list()) {
        if (!s3.has(conn.id)) continue;
        let names: string[];
        try { names = await s3.bucketNames(conn.id); } catch { continue; }
        for (const name of names) {
          const id = `${conn.id}:${name}`;
          const perm = perms.bucketPermFor(user!, id);
          if (perm) out.push({ id, name, connection: conn.name, region: s3.region(conn.id), perm });
        }
      }
      for (const cluster of clustersStore.listFull()) {
        let buckets: { id: string; globalAliases: string[] }[];
        try { buckets = await garageAdmin({ endpoint: cluster.adminEndpoint, token: cluster.adminToken }).listBuckets(); } catch { continue; }
        for (const b of buckets) {
          const name = b.globalAliases[0] ?? b.id;
          const id = `${cluster.id}:${name}`;
          const perm = perms.bucketPermFor(user!, id);
          if (perm) out.push({ id, name, connection: cluster.name, region: cluster.region, perm });
        }
      }
      const aliasMap = bucketAliasStore.getMany(out.map((b) => b.id));
      for (const b of out) b.alias = aliasMap.get(b.id);
      return out;
    })

    // create bucket on a given connection (admin only)
    .post('/buckets', async ({ user, body, set }) => {
      if (user!.role !== 'admin') { set.status = 403; return { error: 'forbidden' }; }
      if (isCluster(body.connectionId)) { set.status = 400; return { error: 'use /api/clusters/:id/buckets' }; }
      if (!s3.has(body.connectionId)) { set.status = 400; return { error: 'unknown_connection' }; }
      try { await s3.createBucket(body.connectionId, body.name); } catch (e) { set.status = 502; return { error: String(e) }; }
      const conn = connectionsStore.get(body.connectionId)!;
      audit.log('bucket', user!.username, body.name, `criou bucket em ${conn.name}`);
      set.status = 201;
      return { id: `${body.connectionId}:${body.name}`, name: body.name, connection: conn.name, region: s3.region(body.connectionId), perm: 'owner' };
    }, { body: t.Object({ connectionId: t.String({ minLength: 1 }), name: t.String({ minLength: 1 }) }) })

    // define/limpa o apelido de um bucket (acesso de escrita ao bucket)
    .patch('/buckets/alias', async ({ user, body, set }) => {
      const ref = parse(body.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const perm = perms.bucketPermFor(user!, body.id);
      if (perm !== 'owner' && perm !== 'read-write') { set.status = 403; return { error: 'forbidden' }; }
      const alias = body.alias.trim();
      if (alias) bucketAliasStore.set(body.id, alias);
      else bucketAliasStore.clear(body.id);
      audit.log('bucket', user!.username, body.id, alias ? `apelido: ${alias}` : 'apelido removido');
      return { ok: true, alias: alias || null };
    }, { body: t.Object({ id: t.String({ minLength: 1 }), alias: t.String({ maxLength: 200 }) }) })

    // list objects (paginated) — filtered to what the caller can see at `path`
    .get('/buckets/:id/objects', async ({ user, params, query, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const access = perms.access(user!, params.id);
      if (!access || !perms.hasBucketAccess(access)) { set.status = 403; return { error: 'forbidden' }; }
      const q = query as Record<string, string>;
      const path = norm(q['path'] ?? '');
      const token = q['token'] || undefined;
      const limit = q['limit'] ? Number(q['limit']) : undefined;
      try {
        await ensureSource(ref);
        const { items, nextToken } = await s3.list(ref.cid, ref.bucket, path, { token, limit });
        const visible = access.all ? items : items.filter((it) =>
          it.kind === 'folder' ? perms.folderVisible(access, it.key) : perms.canRead(access, it.key));
        return { bucket: params.id, path, items: visible, perm: perms.permForKey(access, path), nextToken };
      } catch (e) {
        if (String(e).includes('connection_not_found')) { set.status = 503; return { error: 's3_not_configured' }; }
        set.status = 502; return { error: 's3_error' };
      }
    })

    // computed bucket usage (scoped to readable keys) — cached briefly per user
    .get('/buckets/:id/stats', async ({ user, params, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const access = perms.access(user!, params.id);
      if (!access || !perms.hasBucketAccess(access)) { set.status = 403; return { error: 'forbidden' }; }
      const cacheKey = `${user!.username}|${params.id}`;
      const hit = statsCache.get(cacheKey);
      if (hit && Date.now() - hit.at < STATS_TTL) return { used: hit.used, objects: hit.objects, truncated: hit.truncated };
      try {
        await ensureSource(ref);
        const keep = access.all ? undefined : (k: string) => perms.canRead(access, k);
        const s = await s3.stats(ref.cid, ref.bucket, keep);
        statsCache.set(cacheKey, { at: Date.now(), ...s });
        return s;
      } catch (e) {
        if (String(e).includes('connection_not_found')) { set.status = 503; return { error: 's3_not_configured' }; }
        set.status = 502; return { error: 's3_error' };
      }
    })

    // recursive search under a prefix — results filtered to readable keys
    .get('/buckets/:id/search', async ({ user, params, query, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const access = perms.access(user!, params.id);
      if (!access || !perms.hasBucketAccess(access)) { set.status = 403; return { error: 'forbidden' }; }
      const q = (query as Record<string, string>)['q']?.trim() ?? '';
      if (!q) return { bucket: params.id, items: [] };
      const path = norm((query as Record<string, string>)['path'] ?? '');
      const limit = Math.min(1000, Math.max(1, Number((query as Record<string, string>)['limit']) || 300));
      try {
        await ensureSource(ref);
        const items = await s3.search(ref.cid, ref.bucket, path, q, limit);
        const visible = access.all ? items : items.filter((it) => perms.canRead(access, it.key));
        return { bucket: params.id, path, items: visible };
      } catch (e) {
        if (String(e).includes('connection_not_found')) { set.status = 503; return { error: 's3_not_configured' }; }
        set.status = 502; return { error: 's3_error' };
      }
    })

    .get('/buckets/:id/download', async ({ user, params, query, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const access = perms.access(user!, params.id);
      const key = (query as Record<string, string>)['key'];
      if (!key) { set.status = 400; return { error: 'missing_key' }; }
      if (!access || !perms.canRead(access, key)) { set.status = 403; return { error: 'forbidden' }; }
      await ensureSource(ref);
      const r = await s3.presign(ref.cid, ref.bucket, key, 'download');
      audit.log('download', user!.username, params.id, key);
      return r;
    })

    .get('/buckets/:id/preview', async ({ user, params, query, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const access = perms.access(user!, params.id);
      const key = (query as Record<string, string>)['key'];
      if (!key) { set.status = 400; return { error: 'missing_key' }; }
      if (!access || !perms.canRead(access, key)) { set.status = 403; return { error: 'forbidden' }; }
      await ensureSource(ref);
      return s3.presign(ref.cid, ref.bucket, key, 'preview');
    })

    .get('/buckets/:id/raw', async ({ user, params, query, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const access = perms.access(user!, params.id);
      const q = query as Record<string, string>;
      const key = q['key'];
      if (!key) { set.status = 400; return { error: 'missing_key' }; }
      if (!access || !perms.canRead(access, key)) { set.status = 403; return { error: 'forbidden' }; }
      const mode = q['mode'] === 'download' ? 'download' : 'preview';
      try {
        await ensureSource(ref);
        const res = await s3.object(ref.cid, ref.bucket, key, mode);
        if (mode === 'download') audit.log('download', user!.username, params.id, key);
        return res;
      } catch (e) {
        if (String(e).includes('connection_not_found')) { set.status = 503; return { error: 's3_not_configured' }; }
        set.status = 502; return { error: 's3_error' };
      }
    })

    .post('/buckets/:id/objects', async ({ user, params, body, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const access = perms.access(user!, params.id);
      const path = norm(body.path ?? '');
      const file = body.file;
      const key = path + file.name;
      if (!access || !perms.canWrite(access, key)) { set.status = 403; return { error: 'forbidden' }; }
      await ensureSource(ref);
      const data = new Uint8Array(await file.arrayBuffer());
      await s3.put(ref.cid, ref.bucket, key, data, file.type || undefined);
      audit.log('upload', user!.username, params.id, key);
      return { ok: true, key };
    }, { body: t.Object({ path: t.Optional(t.String()), file: t.File() }) })

    .post('/buckets/:id/folders', async ({ user, params, body, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const access = perms.access(user!, params.id);
      const key = norm(body.path ?? '') + body.name + '/';
      if (!access || !perms.canWrite(access, key)) { set.status = 403; return { error: 'forbidden' }; }
      await ensureSource(ref);
      await s3.createFolder(ref.cid, ref.bucket, key);
      return { ok: true, key };
    }, { body: t.Object({ path: t.Optional(t.String()), name: t.String({ minLength: 1 }) }) })

    .delete('/buckets/:id/objects', async ({ user, params, body, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const access = perms.access(user!, params.id);
      if (!access) { set.status = 403; return { error: 'forbidden' }; }
      for (const k of body.keys) if (!perms.canWrite(access, k)) { set.status = 403; return { error: 'forbidden' }; }
      await ensureSource(ref);
      await s3.remove(ref.cid, ref.bucket, body.keys);
      for (const k of body.keys) audit.log('delete', user!.username, params.id, k);
      return { ok: true };
    }, { body: t.Object({ keys: t.Array(t.String(), { minItems: 1 }) }) })

    .delete('/buckets/:id', async ({ user, params, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const perm = perms.bucketPermFor(user!, params.id);
      if (perm !== 'owner') { set.status = 403; return { error: 'forbidden' }; }
      try {
        await ensureSource(ref);
        const empty = await s3.isEmpty(ref.cid, ref.bucket);
        if (!mayDeleteBucket(perm, empty)) { set.status = 409; return { error: 'bucket_not_empty' }; }
        if (isCluster(ref.cid)) {
          const c = clustersStore.getFull(ref.cid);
          if (!c) { set.status = 404; return { error: 'cluster_not_found' }; }
          const g = garageAdmin({ endpoint: c.adminEndpoint, token: c.adminToken });
          const hexId = await g.resolveBucketId(ref.bucket);
          await g.deleteBucket(hexId);
          revokeClusterBucketAccess(ref.cid, ref.bucket);
        } else {
          await s3.deleteBucket(ref.cid, ref.bucket);
        }
        bucketAliasStore.clear(params.id);
        for (const k of [...statsCache.keys()]) if (k.endsWith(`|${params.id}`)) statsCache.delete(k);
        audit.log('bucket', user!.username, params.id, 'excluiu bucket');
        return { ok: true };
      } catch (e) {
        if (String(e).includes('connection_not_found')) { set.status = 503; return { error: 's3_not_configured' }; }
        set.status = 502; return { error: String((e as Error)?.message || e) };
      }
    }),
  );
