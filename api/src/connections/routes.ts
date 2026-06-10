import { Elysia, t } from 'elysia';
import { authDerive, requireAdmin } from '../auth/guard';
import { connectionsStore, type ConnInput } from './store';
import { s3, isValidConfig } from '../storage/s3';
import { audit } from '../audit/store';

const bodySchema = t.Object({
  name: t.String({ minLength: 1 }),
  endpoint: t.String(),
  region: t.Optional(t.String()),
  accessKey: t.String(),
  secretKey: t.Optional(t.String()),
  buckets: t.Optional(t.Array(t.String())),
});

type Body = { name?: string; endpoint: string; region?: string; accessKey: string; secretKey?: string; buckets?: string[] };

/** Build a ConnInput, falling back to the stored secret when omitted on update. */
function toInput(body: Body, existingId?: string): ConnInput {
  let secretKey = body.secretKey ?? '';
  if (!secretKey && existingId) secretKey = connectionsStore.getFull(existingId)?.secretKey ?? '';
  return {
    name: (body.name ?? '').trim(),
    endpoint: body.endpoint.trim(),
    region: (body.region || 'garage').trim(),
    accessKey: body.accessKey.trim(),
    secretKey,
    buckets: (body.buckets ?? []).map((b) => b.trim()).filter(Boolean),
  };
}

export const connectionsRoutes = new Elysia({ prefix: '/api/connections' })
  .use(authDerive)
  .guard({ beforeHandle: requireAdmin }, (app) => app

    .get('/', () => connectionsStore.list())

    .post('/', ({ body, set, user }) => {
      const input = toInput(body);
      if (!isValidConfig(input)) { set.status = 400; return { error: 'endpoint, accessKey e secretKey são obrigatórios' }; }
      const conn = connectionsStore.create(input);
      s3.configureOne(conn);
      audit.log('bucket', user!.username, '—', `criou conexão ${conn.name}`);
      set.status = 201;
      return connectionsStore.get(conn.id);
    }, { body: bodySchema })

    .put('/:id', ({ params, body, set, user }) => {
      if (!connectionsStore.exists(params.id)) { set.status = 404; return { error: 'not_found' }; }
      const input = toInput(body, params.id);
      if (!isValidConfig(input)) { set.status = 400; return { error: 'endpoint, accessKey e secretKey são obrigatórios' }; }
      const conn = connectionsStore.update(params.id, input)!;
      s3.configureOne(conn);
      audit.log('bucket', user!.username, '—', `atualizou conexão ${conn.name}`);
      return connectionsStore.get(conn.id);
    }, { body: bodySchema })

    .delete('/:id', ({ params, set, user }) => {
      const c = connectionsStore.get(params.id);
      if (!c) { set.status = 404; return { error: 'not_found' }; }
      connectionsStore.remove(params.id);
      s3.removeOne(params.id);
      audit.log('bucket', user!.username, '—', `removeu conexão ${c.name}`);
      return { ok: true };
    })

    // test a config (existing or new) without persisting
    .post('/test', async ({ body, set }) => {
      const input = toInput(body, (body as Body & { id?: string }).id);
      if (!isValidConfig(input)) { set.status = 400; return { ok: false, error: 'endpoint, accessKey e secretKey são obrigatórios' }; }
      try {
        const buckets = await s3.test(input);
        return { ok: true, buckets };
      } catch (e) {
        return { ok: false, error: String((e as Error)?.message ?? e) };
      }
    }, { body: t.Object({
      id: t.Optional(t.String()),
      name: t.Optional(t.String()),
      endpoint: t.String(),
      region: t.Optional(t.String()),
      accessKey: t.String(),
      secretKey: t.Optional(t.String()),
      buckets: t.Optional(t.Array(t.String())),
    }) }),
  );
