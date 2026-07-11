import { Elysia, t } from 'elysia';
import { authDerive, requireUser } from '../auth/guard';
import { perms } from '../auth/permissions';
import { audit } from '../audit/store';
import { usersStore } from '../users/store';
import { sharesStore } from './store';

const ALLOWED_TTL = new Set([3600, 86400, 604800, 2592000]);

/** Bucket ids are composite: `<connectionId>:<bucketName>`. */
function parse(id: string): { cid: string; bucket: string } | null {
  const i = id.indexOf(':');
  if (i <= 0) return null;
  return { cid: id.slice(0, i), bucket: id.slice(i + 1) };
}

export const shareRoutes = new Elysia({ prefix: '/api' })
  .use(authDerive)
  .guard({ beforeHandle: requireUser }, (app) => app

    // create a public share link for a file the caller can download
    .post('/shares', ({ user, body, set }) => {
      if (!ALLOWED_TTL.has(body.ttl)) { set.status = 400; return { error: 'bad_ttl' }; }
      const u = usersStore.get(user!.username);
      const canShare = user!.role === 'admin' || !!u?.canShare;
      if (!canShare) { set.status = 403; return { error: 'forbidden' }; }
      if (!parse(body.bucketId)) { set.status = 400; return { error: 'bad_bucket_id' }; }
      const access = perms.access(user!, body.bucketId);
      if (!access || !perms.canDownload(access, body.key)) { set.status = 403; return { error: 'forbidden' }; }
      const row = sharesStore.create({
        bucketId: body.bucketId,
        key: body.key,
        createdBy: user!.username,
        ttlSec: body.ttl,
        lockIp: !!body.lockIp,
      });
      audit.log('share', user!.username, body.bucketId, body.key);
      return {
        token: row.token,
        expiresAt: row.expiresAt,
        key: row.key,
        bucketId: row.bucketId,
        lockIp: row.lockIp === 1,
      };
    }, { body: t.Object({
      bucketId: t.String({ minLength: 1 }),
      key: t.String({ minLength: 1 }),
      ttl: t.Number(),
      lockIp: t.Optional(t.Boolean()),
    }) })

    // list the caller's own share links (admin also sees only their own)
    .get('/shares', ({ user }) => sharesStore.listByUser(user!.username))

    // revoke a link (creator or admin only)
    .delete('/shares/:token', ({ user, params, set }) => {
      const row = sharesStore.get(params.token);
      if (!row) { set.status = 404; return { error: 'not_found' }; }
      if (row.createdBy !== user!.username && user!.role !== 'admin') { set.status = 403; return { error: 'forbidden' }; }
      sharesStore.revoke(params.token);
      audit.log('share', user!.username, row.bucketId, 'revogou link');
      return { ok: true };
    }),
  );
