// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { Elysia, t } from 'elysia';
import { config } from '../config';
import { authDerive, requireAdmin } from './guard';
import { requireFeature } from '../license/service';
import { usersStore } from '../users/store';
import { audit } from '../audit/store';
import { sessions } from './sessions';
import { setRefresh, type CookieJar } from './routes';
import {
  oidcConfig, ssoActive, publicOidcInfo, redirectUriFor, isValidIssuer,
} from './oidc-config';
import {
  pendingLogins, fetchDiscovery, authorizationUrl, exchangeCode, verifyIdToken,
  decideIdentity, randomToken, chooseTokenAuthMethod, PENDING_TTL_MS,
} from './oidc';

export const OIDC_STATE_COOKIE = 'cs3_oidc';
const OIDC_COOKIE_PATH = '/api/auth/oidc';

type Headers = Record<string, string | undefined>;
type RedirectCtx = { set: { status?: number | string; headers: Record<string, string | number> } };

function redirectTo(ctx: RedirectCtx, location: string) {
  ctx.set.status = 302;
  ctx.set.headers['location'] = location;
  ctx.set.headers['cache-control'] = 'no-store';
  return '';
}

const failTo = (ctx: RedirectCtx, code: string) => redirectTo(ctx, `/?sso_error=${encodeURIComponent(code)}`);

function setStateCookie(jar: CookieJar, state: string) {
  jar[OIDC_STATE_COOKIE]!.set({
    value: state, httpOnly: true, secure: config.cookieSecure, sameSite: 'lax',
    path: OIDC_COOKIE_PATH, maxAge: Math.floor(PENDING_TTL_MS / 1000),
  });
}

function clearStateCookie(jar: CookieJar) {
  jar[OIDC_STATE_COOKIE]!.set({
    value: '', httpOnly: true, secure: config.cookieSecure, sameSite: 'lax',
    path: OIDC_COOKIE_PATH, maxAge: 0,
  });
}

function settingsPayload(headers: Headers, requestUrl: string) {
  return {
    ...oidcConfig.toPublic(oidcConfig.get()),
    redirectUri: redirectUriFor(headers, requestUrl),
    active: ssoActive(),
  };
}

const errorMessage = (e: unknown) => String((e as Error)?.message ?? e);

export const oidcRoutes = new Elysia({ prefix: '/api/auth/oidc' })
  .use(authDerive)

  .get('/config-public', () => publicOidcInfo())

  .get('/login', async ({ set, cookie, headers, request }) => {
    const ctx = { set } as RedirectCtx;
    const s = oidcConfig.get();
    if (!ssoActive(s)) return failTo(ctx, 'disabled');
    let doc;
    try { doc = await fetchDiscovery(s.issuer); } catch (e) {
      console.warn('[oidc] descoberta falhou:', errorMessage(e));
      return failTo(ctx, 'discovery');
    }
    const redirectUri = redirectUriFor(headers as Headers, request.url);
    const { state, nonce, challenge } = pendingLogins.begin(redirectUri);
    setStateCookie(cookie as unknown as CookieJar, state);
    return redirectTo(ctx, authorizationUrl(doc, s, { redirectUri, state, nonce, challenge }));
  })

  .get('/callback', async ({ set, cookie, headers, query }) => {
    const ctx = { set } as RedirectCtx;
    const jar = cookie as unknown as CookieJar;
    const boundState = jar[OIDC_STATE_COOKIE]?.value;
    clearStateCookie(jar);

    const s = oidcConfig.get();
    if (!ssoActive(s)) return failTo(ctx, 'disabled');
    const q = query as Record<string, string | undefined>;
    if (q.error) return failTo(ctx, 'idp');

    const login = pendingLogins.consume(q.state, boundState);
    if (!login || !q.code) return failTo(ctx, 'state');

    let claims;
    try {
      const doc = await fetchDiscovery(s.issuer);
      const idToken = await exchangeCode(doc, s, q.code, login);
      claims = await verifyIdToken(doc, s.clientId, idToken, login.nonce);
    } catch (e) {
      console.warn('[oidc] callback rejeitado:', errorMessage(e));
      return failTo(ctx, 'token');
    }

    const decision = decideIdentity(claims, s, (username) => {
      const row = usersStore.raw(username);
      return row ? { active: row.active === 1 } : null;
    });
    if (!decision.ok) return failTo(ctx, decision.error);

    if (decision.provisionRole) {
      await usersStore.create(decision.username, randomToken(48), decision.provisionRole);
      audit.log('grant', decision.username, '—', `conta criada via SSO (${decision.provisionRole})`);
    }

    const ua = (headers as Headers)['user-agent'] ?? null;
    const refreshToken = sessions.start(decision.username, ua);
    setRefresh(jar, refreshToken);
    usersStore.touchLogin(decision.username);
    audit.log('key', decision.username, '—', 'entrou via SSO (OIDC)');
    return redirectTo(ctx, '/');
  })

  .guard({ beforeHandle: requireAdmin }, (app) => app
    .get('/settings', ({ headers, request }) => settingsPayload(headers as Headers, request.url))

    .guard({ beforeHandle: requireFeature('sso') }, (gated) => gated
      .put('/settings', ({ body, set, user, headers, request }) => {
        const issuer = body.issuer?.trim();
        if (issuer && !isValidIssuer(issuer)) { set.status = 400; return { error: 'invalid_issuer' }; }
        const merged = { ...oidcConfig.get(), ...body };
        if (merged.enabled && (!isValidIssuer(merged.issuer.trim()) || !merged.clientId.trim())) {
          set.status = 400; return { error: 'incomplete' };
        }
        oidcConfig.set(body);
        audit.log('key', user!.username, 'sso', 'configuração SSO atualizada');
        return settingsPayload(headers as Headers, request.url);
      }, { body: t.Object({
        enabled: t.Optional(t.Boolean()),
        issuer: t.Optional(t.String({ maxLength: 2048 })),
        clientId: t.Optional(t.String({ maxLength: 512 })),
        clientSecret: t.Optional(t.String({ maxLength: 4096 })),
        scopes: t.Optional(t.String({ maxLength: 1024 })),
        buttonLabel: t.Optional(t.String({ maxLength: 64 })),
        usernameClaim: t.Optional(t.String({ maxLength: 128 })),
        autoProvision: t.Optional(t.Boolean()),
        allowedDomains: t.Optional(t.Array(t.String({ maxLength: 255 }), { maxItems: 100 })),
        adminGroup: t.Optional(t.String({ maxLength: 255 })),
        disablePasswordLogin: t.Optional(t.Boolean()),
      }) })

      .post('/test', async ({ body }) => {
        const issuer = (body?.issuer ?? oidcConfig.get().issuer).trim();
        if (!isValidIssuer(issuer)) return { ok: false, error: 'issuer inválido' };
        try {
          const doc = await fetchDiscovery(issuer, { fresh: true });
          return {
            ok: true,
            issuer: doc.issuer,
            authorizationEndpoint: doc.authorization_endpoint,
            tokenEndpoint: doc.token_endpoint,
            jwksUri: doc.jwks_uri,
            userinfoEndpoint: doc.userinfo_endpoint ?? null,
            tokenAuthMethod: chooseTokenAuthMethod(doc),
            pkce: !doc.code_challenge_methods_supported || doc.code_challenge_methods_supported.includes('S256'),
          };
        } catch (e) {
          return { ok: false, error: errorMessage(e) };
        }
      }, { body: t.Optional(t.Object({ issuer: t.Optional(t.String({ maxLength: 2048 })) })) }),
    ),
  );
