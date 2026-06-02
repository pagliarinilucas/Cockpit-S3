import { Elysia, t } from 'elysia';
import { authDerive, requireAdmin } from '../auth/guard';
import { usersStore } from './store';
import { sessions } from '../auth/sessions';
import { audit } from '../audit/store';
import type { Perm } from '../types';

const PERMS = ['owner', 'read-write', 'read-only'] as const;

export const userRoutes = new Elysia({ prefix: '/api/users' })
  .use(authDerive)
  .guard({ beforeHandle: requireAdmin }, (app) => app

    .get('/', () => usersStore.list())

    .post('/', async ({ body, set }) => {
      if (usersStore.exists(body.username)) { set.status = 409; return { error: 'exists' }; }
      const u = await usersStore.create(body.username, body.password, body.role);
      set.status = 201;
      return u;
    }, { body: t.Object({
      username: t.String({ minLength: 1, maxLength: 64 }),
      password: t.String({ minLength: 6 }),
      role: t.Union([t.Literal('admin'), t.Literal('user')]),
    }) })

    .patch('/:username', ({ params, body, set }) => {
      const u = usersStore.setRole(params.username, body.role);
      if (!u) { set.status = 404; return { error: 'not_found' }; }
      return u;
    }, { body: t.Object({ role: t.Union([t.Literal('admin'), t.Literal('user')]) }) })

    .patch('/:username/grants', ({ params, body, set, user }) => {
      if (!usersStore.exists(params.username)) { set.status = 404; return { error: 'not_found' }; }
      const perm = body.perm as Perm | null;
      const updated = usersStore.setGrant(params.username, body.bucketId, perm);
      audit.log(perm ? 'grant' : 'revoke', user!.username, body.bucketId,
        `${params.username}${perm ? ' → ' + perm : ' ✕'}`);
      return updated;
    }, { body: t.Object({
      bucketId: t.String({ minLength: 1 }),
      perm: t.Union([t.Literal('owner'), t.Literal('read-write'), t.Literal('read-only'), t.Null()]),
    }) })

    .post('/:username/password', async ({ params, body, set }) => {
      if (!usersStore.exists(params.username)) { set.status = 404; return { error: 'not_found' }; }
      await usersStore.setPassword(params.username, body.password); // bumps version
      sessions.revokeAllForUser(params.username);
      return { ok: true };
    }, { body: t.Object({ password: t.String({ minLength: 6 }) }) })

    .delete('/:username', ({ params, set, user }) => {
      if (params.username === user!.username) { set.status = 400; return { error: 'cannot_delete_self' }; }
      if (!usersStore.exists(params.username)) { set.status = 404; return { error: 'not_found' }; }
      sessions.revokeAllForUser(params.username);
      usersStore.remove(params.username);
      return { ok: true };
    }),
  );

export { PERMS };
