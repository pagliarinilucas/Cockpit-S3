import { Elysia, t } from 'elysia';
import { authDerive, requireAdmin } from '../auth/guard';
import { groupsStore } from './store';
import { audit } from '../audit/store';
import type { Perm } from '../types';

const norm = (p?: string) => (p ? (p.endsWith('/') ? p : p + '/') : '');

export const groupRoutes = new Elysia({ prefix: '/api/groups' })
  .use(authDerive)
  .guard({ beforeHandle: requireAdmin }, (app) => app

    .get('/', () => groupsStore.list())

    .post('/', ({ body, set, user }) => {
      if (groupsStore.nameExists(body.name)) { set.status = 409; return { error: 'exists' }; }
      const g = groupsStore.create(body.name);
      audit.log('grant', user!.username, '—', `criou grupo ${body.name}`);
      set.status = 201;
      return g;
    }, { body: t.Object({ name: t.String({ minLength: 1, maxLength: 64 }) }) })

    .patch('/:id', ({ params, body, set }) => {
      if (!groupsStore.exists(params.id)) { set.status = 404; return { error: 'not_found' }; }
      if (groupsStore.nameExists(body.name)) { set.status = 409; return { error: 'exists' }; }
      groupsStore.rename(params.id, body.name);
      return groupsStore.get(params.id);
    }, { body: t.Object({ name: t.String({ minLength: 1, maxLength: 64 }) }) })

    .delete('/:id', ({ params, set, user }) => {
      if (!groupsStore.exists(params.id)) { set.status = 404; return { error: 'not_found' }; }
      groupsStore.remove(params.id);
      audit.log('revoke', user!.username, '—', `removeu grupo ${params.id}`);
      return { ok: true };
    })

    // set/remove an ALLOW grant on the group (perm null removes)
    .put('/:id/grants', ({ params, body, set, user }) => {
      if (!groupsStore.exists(params.id)) { set.status = 404; return { error: 'not_found' }; }
      const prefix = norm(body.prefix);
      const perm = body.perm as Perm | null;
      groupsStore.setGrant(params.id, body.bucketId, prefix, perm);
      audit.log(perm ? 'grant' : 'revoke', user!.username, body.bucketId,
        `grupo ${params.id}${prefix ? ' /' + prefix : ''}${perm ? ' → ' + perm : ' ✕'}`);
      return groupsStore.get(params.id);
    }, { body: t.Object({
      bucketId: t.String({ minLength: 1 }),
      prefix: t.Optional(t.String()),
      perm: t.Union([t.Literal('owner'), t.Literal('read-write'), t.Literal('read-only'), t.Null()]),
    }) }),
  );
