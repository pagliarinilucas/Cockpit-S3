import { usersStore } from '../users/store';
import { verifyPassword } from './passwords';
import { signAccess } from './tokens';
import { sessions } from './sessions';
import type { PublicUser } from '../types';

export interface AuthBundle {
  accessToken: string;
  expiresIn: number;        // seconds
  refreshToken: string;     // caller puts this in the httpOnly cookie
  user: PublicUser;
}

import { config } from '../config';

async function issue(username: string, refreshToken: string): Promise<AuthBundle> {
  const u = usersStore.raw(username)!;
  const accessToken = await signAccess(u.username, u.role, u.token_version);
  return {
    accessToken,
    expiresIn: config.accessTtl,
    refreshToken,
    user: usersStore.get(username)!,
  };
}

export const authService = {
  /** Verify credentials and start a new session family. Returns null on bad creds. */
  async login(username: string, password: string, userAgent: string | null): Promise<AuthBundle | null> {
    const u = usersStore.raw(username);
    // Always run a verify to keep timing roughly constant even for unknown users.
    const hash = u?.password_hash ?? '$argon2id$v=19$m=19456,t=2,p=1$xxxxxxxxxxxxxxxxxxxxxx$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    const ok = await verifyPassword(password, hash);
    if (!u || !ok || u.active !== 1) return null;

    usersStore.touchLogin(username);
    const refreshToken = sessions.start(username, userAgent);
    return issue(username, refreshToken);
  },

  /** Rotate a refresh token into a fresh access+refresh pair. */
  async refresh(presented: string, userAgent: string | null): Promise<AuthBundle | { error: string } > {
    const r = sessions.rotate(presented, userAgent);
    if (!r.ok) {
      if (r.reason === 'reuse') {
        // Defense in depth: also kill access tokens for the affected user is handled
        // at the family level; nothing else to do here without the username.
      }
      return { error: r.reason };
    }
    return issue(r.username, r.token);
  },

  logout(presented: string | undefined): void {
    if (presented) sessions.revokeByToken(presented);
  },

  /** Global sign-out: invalidate every access token (version bump) and every session. */
  logoutAll(username: string): void {
    usersStore.bumpVersion(username);
    sessions.revokeAllForUser(username);
  },

  /** Change own password: re-auth with current password, bump version, drop sessions. */
  async changePassword(username: string, current: string, next: string): Promise<boolean> {
    const u = usersStore.raw(username);
    if (!u) return false;
    if (!(await verifyPassword(current, u.password_hash))) return false;
    await usersStore.setPassword(username, next); // bumps version
    sessions.revokeAllForUser(username);
    return true;
  },
};
