// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { Elysia, t } from 'elysia';
import { config } from '../config';
import { authService } from './service';
import { tooManyAttempts, resetAttempts } from './ratelimit';
import { authDerive, requireUser } from './guard';
import { usersStore } from '../users/store';

type CookieJar = Record<string, { value?: string; set: (o: Record<string, unknown>) => void }>;

function setRefresh(cookie: CookieJar, token: string) {
  cookie[config.refreshCookie]!.set({
    value: token, httpOnly: true, secure: config.cookieSecure, sameSite: 'strict',
    path: config.refreshCookiePath, maxAge: config.refreshTtl,
  });
}
function clearRefresh(cookie: CookieJar) {
  cookie[config.refreshCookie]!.set({
    value: '', httpOnly: true, secure: config.cookieSecure, sameSite: 'strict',
    path: config.refreshCookiePath, maxAge: 0,
  });
}

export const authRoutes = new Elysia({ prefix: '/api' })
  .use(authDerive)

  // ---- login ----
  .post('/login', async ({ body, cookie, set, headers }) => {
    const ua = (headers as Record<string, string | undefined>)['user-agent'] ?? null;
    const ip = (headers as Record<string, string | undefined>)['x-forwarded-for']?.split(',')[0]?.trim() ?? 'local';
    const key = `${body.username}:${ip}`;
    if (tooManyAttempts(key)) { set.status = 429; return { error: 'too_many_attempts' }; }

    const bundle = await authService.login(body.username, body.password, ua);
    if (!bundle) { set.status = 401; return { error: 'invalid_credentials' }; }

    resetAttempts(key);
    setRefresh(cookie as unknown as CookieJar, bundle.refreshToken);
    return { accessToken: bundle.accessToken, expiresIn: bundle.expiresIn, user: bundle.user };
  }, { body: t.Object({ username: t.String({ minLength: 1 }), password: t.String({ minLength: 1 }) }) })

  // ---- refresh (rota coberta pelo cookie de path /api/auth) ----
  .post('/auth/refresh', async ({ cookie, set, headers }) => {
    const jar = cookie as unknown as CookieJar;
    const presented = jar[config.refreshCookie]?.value;
    if (!presented) { set.status = 401; return { error: 'no_refresh' }; }
    const ua = (headers as Record<string, string | undefined>)['user-agent'] ?? null;

    const res = await authService.refresh(presented, ua);
    if ('error' in res) { clearRefresh(jar); set.status = 401; return { error: res.error }; }

    setRefresh(jar, res.refreshToken);
    return { accessToken: res.accessToken, expiresIn: res.expiresIn, user: res.user };
  })

  // ---- logout (this device) ----
  .post('/logout', ({ cookie }) => {
    const jar = cookie as unknown as CookieJar;
    authService.logout(jar[config.refreshCookie]?.value);
    clearRefresh(jar);
    return { ok: true };
  })

  // ---- logout everywhere (protected) ----
  .guard({ beforeHandle: requireUser }, (app) => app
    .post('/auth/logout-all', ({ user, cookie }) => {
      authService.logoutAll(user!.username);
      clearRefresh(cookie as unknown as CookieJar);
      return { ok: true };
    })
    .post('/auth/password', async ({ user, body, set, cookie }) => {
      const ok = await authService.changePassword(user!.username, body.current, body.next);
      if (!ok) { set.status = 400; return { error: 'invalid_current_password' }; }
      clearRefresh(cookie as unknown as CookieJar); // force re-login everywhere
      return { ok: true };
    }, { body: t.Object({ current: t.String({ minLength: 1 }), next: t.String({ minLength: 8 }) }) })
    .get('/me', ({ user }) => usersStore.get(user!.username)),
  );
