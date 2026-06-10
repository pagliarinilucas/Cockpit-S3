import { Elysia, t } from 'elysia';
import { authDerive, requireAdmin } from '../auth/guard';
import { connectionsStore } from '../connections/store';
import { garageAdmin, type AdminCreds } from './admin';
import { audit } from '../audit/store';

/** Resolve as credenciais admin de uma conexão, ou null se não configurada. */
function creds(connId: string): AdminCreds | null {
  const c = connectionsStore.getFull(connId);
  if (!c || !c.adminEndpoint || !c.adminToken) return null;
  return { endpoint: c.adminEndpoint, token: c.adminToken };
}

export const garageRoutes = new Elysia({ prefix: '/api/connections/:id' })
  .use(authDerive)
  .guard({ beforeHandle: requireAdmin }, (app) => app

    .get('/cluster', async ({ params, set }) => {
      const cr = creds(params.id);
      if (!cr) { set.status = 409; return { error: 'admin_not_configured' }; }
      try { return await garageAdmin(cr).cluster(); }
      catch (e) { set.status = 502; return { error: String((e as Error).message) }; }
    })

    .get('/garage/buckets', async ({ params, set }) => {
      const cr = creds(params.id);
      if (!cr) { set.status = 409; return { error: 'admin_not_configured' }; }
      const g = garageAdmin(cr);
      try {
        const list = await g.listBuckets();
        const infos = await Promise.all(list.map((b) => g.bucketInfo(b.id)));
        return infos.map((i) => ({ id: i.id, aliases: i.globalAliases, objects: i.objects, bytes: i.bytes, quotas: i.quotas, keys: i.keys }));
      } catch (e) { set.status = 502; return { error: String((e as Error).message) }; }
    })

    .post('/garage/buckets', async ({ params, body, set, user }) => {
      const cr = creds(params.id);
      if (!cr) { set.status = 409; return { error: 'admin_not_configured' }; }
      try { const r = await garageAdmin(cr).createBucket(body.alias); audit.log('bucket', user!.username, '—', `garage: criou bucket ${body.alias}`); set.status = 201; return r; }
      catch (e) { set.status = 502; return { error: String((e as Error).message) }; }
    }, { body: t.Object({ alias: t.String({ minLength: 1 }) }) })

    .delete('/garage/buckets/:bucketId', async ({ params, set, user }) => {
      const cr = creds(params.id);
      if (!cr) { set.status = 409; return { error: 'admin_not_configured' }; }
      try { await garageAdmin(cr).deleteBucket(params.bucketId); audit.log('bucket', user!.username, '—', `garage: removeu bucket ${params.bucketId}`); return { ok: true }; }
      catch (e) { set.status = 502; return { error: String((e as Error).message) }; }
    })

    .put('/garage/buckets/:bucketId/quotas', async ({ params, body, set }) => {
      const cr = creds(params.id);
      if (!cr) { set.status = 409; return { error: 'admin_not_configured' }; }
      try { return await garageAdmin(cr).setQuotas(params.bucketId, body.maxSize, body.maxObjects); }
      catch (e) { set.status = 502; return { error: String((e as Error).message) }; }
    }, { body: t.Object({ maxSize: t.Union([t.Number(), t.Null()]), maxObjects: t.Union([t.Number(), t.Null()]) }) })

    .get('/keys', async ({ params, set }) => {
      const cr = creds(params.id);
      if (!cr) { set.status = 409; return { error: 'admin_not_configured' }; }
      const g = garageAdmin(cr);
      try {
        const list = await g.listKeys();
        const infos = await Promise.all(list.map((k) => g.keyInfo(k.id)));
        return infos.map((i) => ({ id: i.accessKeyId, name: i.name, created: i.created, expired: i.expired, buckets: i.buckets.map((b) => ({ id: b.id, aliases: b.globalAliases, permissions: b.permissions })) }));
      } catch (e) { set.status = 502; return { error: String((e as Error).message) }; }
    })

    .post('/keys', async ({ params, body, set, user }) => {
      const cr = creds(params.id);
      if (!cr) { set.status = 409; return { error: 'admin_not_configured' }; }
      try { const r = await garageAdmin(cr).createKey(body.name); audit.log('key', user!.username, '—', `garage: criou key ${body.name}`); set.status = 201; return r; }
      catch (e) { set.status = 502; return { error: String((e as Error).message) }; }
    }, { body: t.Object({ name: t.String({ minLength: 1 }) }) })

    .delete('/keys/:keyId', async ({ params, set, user }) => {
      const cr = creds(params.id);
      if (!cr) { set.status = 409; return { error: 'admin_not_configured' }; }
      try { await garageAdmin(cr).deleteKey(params.keyId); audit.log('key', user!.username, '—', `garage: removeu key ${params.keyId}`); return { ok: true }; }
      catch (e) { set.status = 502; return { error: String((e as Error).message) }; }
    })

    .put('/keys/:keyId/buckets/:bucketId', async ({ params, body, set }) => {
      const cr = creds(params.id);
      if (!cr) { set.status = 409; return { error: 'admin_not_configured' }; }
      try { await garageAdmin(cr).setBucketKeyPerm(params.bucketId, params.keyId, body); return { ok: true }; }
      catch (e) { set.status = 502; return { error: String((e as Error).message) }; }
    }, { body: t.Object({ read: t.Boolean(), write: t.Boolean(), owner: t.Boolean() }) }),
  );
