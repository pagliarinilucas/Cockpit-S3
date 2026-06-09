import { Elysia } from 'elysia';
import { verifyAccess } from './tokens';
import { usersStore } from '../users/store';
import type { Role } from '../types';

export interface AuthUser { username: string; role: Role }

/**
 * Resolve the caller from a Bearer access token. Returns null (→ 401) unless the
 * token is valid AND its `ver` still matches the user's current token_version,
 * which is how revocation / logout-all / password-change take effect instantly.
 */
export async function resolveUser(authorization?: string): Promise<AuthUser | null> {
  if (!authorization || !authorization.startsWith('Bearer ')) return null;
  const claims = await verifyAccess(authorization.slice(7));
  if (!claims) return null;
  const u = usersStore.raw(claims.sub);
  if (!u || u.active !== 1) return null;
  if (u.tokenVersion !== claims.ver) return null; // token version revoked
  return { username: u.username, role: u.role };
}

/** Plugin that attaches `user: AuthUser | null` to the context. */
export const authDerive = new Elysia({ name: 'auth-derive' })
  .derive({ as: 'scoped' }, async ({ headers }) => ({
    user: await resolveUser((headers as Record<string, string | undefined>)['authorization']),
  }));

// Elysia's beforeHandle context type does not surface the scoped derive (`user`) at
// the guard boundary, so we take the param as `unknown` (assignable to the hook's
// expected context) and narrow to the fields we use. The values exist at runtime
// because the derive runs before beforeHandle.
type GuardCtx = { user: AuthUser | null; set: { status?: number | string } };

export const requireUser = (ctx: unknown): unknown => {
  const { user, set } = ctx as GuardCtx;
  if (!user) { set.status = 401; return { error: 'unauthorized' }; }
  return undefined;
};

export const requireAdmin = (ctx: unknown): unknown => {
  const { user, set } = ctx as GuardCtx;
  if (!user) { set.status = 401; return { error: 'unauthorized' }; }
  if (user.role !== 'admin') { set.status = 403; return { error: 'forbidden' }; }
  return undefined;
};
