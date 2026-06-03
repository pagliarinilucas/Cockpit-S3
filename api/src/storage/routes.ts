import { Elysia, t } from 'elysia';
import { authDerive, requireUser } from '../auth/guard';
import { usersStore } from '../users/store';
import { connectionsStore } from '../connections/store';
import { audit } from '../audit/store';
import { s3 } from './s3';
import type { Perm } from '../types';

const norm = (p: string) => (p ? (p.endsWith('/') ? p : p + '/') : '');
const canRead = (p: Perm | null) => p !== null;
const canWrite = (p: Perm | null) => p === 'owner' || p === 'read-write';

/** Bucket ids are composite: `<connectionId>:<bucketName>`. */
function parse(id: string): { cid: string; bucket: string } | null {
  const i = id.indexOf(':');
  if (i <= 0) return null;
  return { cid: id.slice(0, i), bucket: id.slice(i + 1) };
}

export const storageRoutes = new Elysia({ prefix: '/api' })
  .use(authDerive)
  .guard({ beforeHandle: requireUser }, (app) => app

    // list buckets across all connections the caller can access
    .get('/buckets', async ({ user, set }) => {
      if (!s3.hasAny()) { set.status = 503; return { error: 's3_not_configured' }; }
      const out: { id: string; name: string; connection: string; region: string; perm: Perm }[] = [];
      for (const conn of connectionsStore.list()) {
        if (!s3.has(conn.id)) continue;
        let names: string[];
        try { names = await s3.bucketNames(conn.id); } catch { continue; } // skip unreachable connection
        for (const name of names) {
          const id = `${conn.id}:${name}`;
          const perm = usersStore.permFor(user!.username, id);
          if (perm) out.push({ id, name, connection: conn.name, region: s3.region(conn.id), perm });
        }
      }
      return out;
    })

    // create bucket on a given connection (admin only)
    .post('/buckets', async ({ user, body, set }) => {
      if (user!.role !== 'admin') { set.status = 403; return { error: 'forbidden' }; }
      if (!s3.has(body.connectionId)) { set.status = 400; return { error: 'unknown_connection' }; }
      try { await s3.createBucket(body.connectionId, body.name); } catch (e) { set.status = 502; return { error: String(e) }; }
      const conn = connectionsStore.get(body.connectionId)!;
      audit.log('bucket', user!.username, body.name, `criou bucket em ${conn.name}`);
      set.status = 201;
      return { id: `${body.connectionId}:${body.name}`, name: body.name, connection: conn.name, region: s3.region(body.connectionId), perm: 'owner' };
    }, { body: t.Object({ connectionId: t.String({ minLength: 1 }), name: t.String({ minLength: 1 }) }) })

    // list objects (paginated)
    .get('/buckets/:id/objects', async ({ user, params, query, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const perm = usersStore.permFor(user!.username, params.id);
      if (!canRead(perm)) { set.status = 403; return { error: 'forbidden' }; }
      const q = query as Record<string, string>;
      const path = norm(q['path'] ?? '');
      const token = q['token'] || undefined;
      const limit = q['limit'] ? Number(q['limit']) : undefined;
      try {
        const { items, nextToken } = await s3.list(ref.cid, ref.bucket, path, { token, limit });
        return { bucket: params.id, path, items, nextToken };
      } catch (e) {
        if (String(e).includes('connection_not_found')) { set.status = 503; return { error: 's3_not_configured' }; }
        set.status = 502; return { error: 's3_error' };
      }
    })

    // recursive search under a prefix (scans all pages, not just the loaded ones)
    .get('/buckets/:id/search', async ({ user, params, query, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      if (!canRead(usersStore.permFor(user!.username, params.id))) { set.status = 403; return { error: 'forbidden' }; }
      const q = (query as Record<string, string>)['q']?.trim() ?? '';
      if (!q) return { bucket: params.id, items: [] };
      const path = norm((query as Record<string, string>)['path'] ?? '');
      const limit = Math.min(1000, Math.max(1, Number((query as Record<string, string>)['limit']) || 300));
      try {
        const items = await s3.search(ref.cid, ref.bucket, path, q, limit);
        return { bucket: params.id, path, items };
      } catch (e) {
        if (String(e).includes('connection_not_found')) { set.status = 503; return { error: 's3_not_configured' }; }
        set.status = 502; return { error: 's3_error' };
      }
    })

    .get('/buckets/:id/download', async ({ user, params, query, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      if (!canRead(usersStore.permFor(user!.username, params.id))) { set.status = 403; return { error: 'forbidden' }; }
      const key = (query as Record<string, string>)['key'];
      if (!key) { set.status = 400; return { error: 'missing_key' }; }
      const r = await s3.presign(ref.cid, ref.bucket, key, 'download');
      audit.log('download', user!.username, params.id, key);
      return r;
    })

    .get('/buckets/:id/preview', async ({ user, params, query, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      if (!canRead(usersStore.permFor(user!.username, params.id))) { set.status = 403; return { error: 'forbidden' }; }
      const key = (query as Record<string, string>)['key'];
      if (!key) { set.status = 400; return { error: 'missing_key' }; }
      return s3.presign(ref.cid, ref.bucket, key, 'preview');
    })

    // Stream the object through the API (same origin) — used by preview/download so
    // the browser never hits Garage directly (no mixed-content, endpoint stays private).
    .get('/buckets/:id/raw', async ({ user, params, query, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      if (!canRead(usersStore.permFor(user!.username, params.id))) { set.status = 403; return { error: 'forbidden' }; }
      const q = query as Record<string, string>;
      const key = q['key'];
      if (!key) { set.status = 400; return { error: 'missing_key' }; }
      const mode = q['mode'] === 'download' ? 'download' : 'preview';
      try {
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
      if (!canWrite(usersStore.permFor(user!.username, params.id))) { set.status = 403; return { error: 'forbidden' }; }
      const path = norm(body.path ?? '');
      const file = body.file;
      const key = path + file.name;
      const data = new Uint8Array(await file.arrayBuffer());
      await s3.put(ref.cid, ref.bucket, key, data, file.type || undefined);
      audit.log('upload', user!.username, params.id, key);
      return { ok: true, key };
    }, { body: t.Object({ path: t.Optional(t.String()), file: t.File() }) })

    .post('/buckets/:id/folders', async ({ user, params, body, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      if (!canWrite(usersStore.permFor(user!.username, params.id))) { set.status = 403; return { error: 'forbidden' }; }
      const key = norm(body.path ?? '') + body.name + '/';
      await s3.createFolder(ref.cid, ref.bucket, key);
      return { ok: true, key };
    }, { body: t.Object({ path: t.Optional(t.String()), name: t.String({ minLength: 1 }) }) })

    .delete('/buckets/:id/objects', async ({ user, params, body, set }) => {
      const ref = parse(params.id);
      if (!ref) { set.status = 400; return { error: 'bad_bucket_id' }; }
      if (!canWrite(usersStore.permFor(user!.username, params.id))) { set.status = 403; return { error: 'forbidden' }; }
      await s3.remove(ref.cid, ref.bucket, body.keys);
      for (const k of body.keys) audit.log('delete', user!.username, params.id, k);
      return { ok: true };
    }, { body: t.Object({ keys: t.Array(t.String(), { minItems: 1 }) }) }),
  );
