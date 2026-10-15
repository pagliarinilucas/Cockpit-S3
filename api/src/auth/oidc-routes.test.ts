// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT, type JWTPayload } from 'jose';
import type { Elysia } from 'elysia';
import { pkceChallenge } from './oidc';

const DB = join(tmpdir(), `cockpit-oidc-routes-${randomUUID()}.sqlite`);
process.env.DB_PATH = DB;
delete process.env.PUBLIC_URL;
delete process.env.COCKPIT_LICENSE_KEY;
delete process.env.COCKPIT_LICENSE_FILE;

const CLIENT_ID = 'cockpit';
const CLIENT_SECRET = 's3cr3t';
const APP = 'http://cockpit.test';

interface IssuedCode { nonce: string; challenge: string; redirectUri: string; claims: JWTPayload }

const idp = {
  server: null as ReturnType<typeof Bun.serve> | null,
  issuer: '',
  authMethods: ['client_secret_basic'] as string[],
  nextClaims: {} as JWTPayload,
  audience: CLIENT_ID,
  codes: new Map<string, IssuedCode>(),
  tokenCalls: [] as { auth: string | null; form: URLSearchParams }[],
};

let app: Elysia;
let usersStore: typeof import('../users/store').usersStore;
let oidcConfig: typeof import('./oidc-config').oidcConfig;
let license: typeof import('../license/service').license;
let signAccess: typeof import('./tokens').signAccess;
let clearOidcCaches: typeof import('./oidc').clearOidcCaches;
let licenseKey = '';

function cookiesOf(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const eq = pair!.indexOf('=');
    out[pair!.slice(0, eq)] = decodeURIComponent(pair!.slice(eq + 1));
  }
  return out;
}

function req(path: string, opts: { method?: string; token?: string; body?: unknown; cookie?: string } = {}): Request {
  const headers: Record<string, string> = {};
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
  if (opts.cookie) headers['cookie'] = opts.cookie;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`${APP}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

async function tokenFor(username: string, role: 'admin' | 'user'): Promise<string> {
  if (!usersStore.exists(username)) await usersStore.create(username, 'senha12345', role);
  return signAccess(username, role, usersStore.raw(username)!.tokenVersion);
}

async function startLogin(): Promise<{ authorize: URL; stateCookie: string }> {
  const res = await app.handle(req('/api/auth/oidc/login'));
  expect(res.status).toBe(302);
  const stateCookie = cookiesOf(res).cs3_oidc!;
  return { authorize: new URL(res.headers.get('location')!), stateCookie };
}

async function idpAuthorize(authorize: URL, claims: JWTPayload): Promise<URL> {
  idp.nextClaims = claims;
  const res = await fetch(authorize, { redirect: 'manual' });
  expect(res.status).toBe(302);
  return new URL(res.headers.get('location')!);
}

async function fullLogin(claims: JWTPayload, cookieOverride?: string): Promise<Response> {
  const { authorize, stateCookie } = await startLogin();
  const back = await idpAuthorize(authorize, claims);
  const cookie = `cs3_oidc=${cookieOverride ?? stateCookie}`;
  return app.handle(req(`/api/auth/oidc/callback${back.search}`, { cookie }));
}

async function installLicense() {
  license.install(licenseKey);
  expect(license.has('sso')).toBe(true);
}

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };

  idp.server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/.well-known/openid-configuration') {
        return Response.json({
          issuer: idp.issuer,
          authorization_endpoint: `${idp.issuer}/authorize`,
          token_endpoint: `${idp.issuer}/token`,
          jwks_uri: `${idp.issuer}/jwks`,
          token_endpoint_auth_methods_supported: idp.authMethods,
          code_challenge_methods_supported: ['S256'],
        });
      }
      if (url.pathname === '/jwks') return Response.json({ keys: [jwk] });
      if (url.pathname === '/authorize') {
        const p = url.searchParams;
        if (p.get('code_challenge_method') !== 'S256' || p.get('client_id') !== CLIENT_ID) return new Response('bad', { status: 400 });
        const code = randomUUID();
        idp.codes.set(code, {
          nonce: p.get('nonce')!, challenge: p.get('code_challenge')!, redirectUri: p.get('redirect_uri')!, claims: idp.nextClaims,
        });
        const back = new URL(p.get('redirect_uri')!);
        back.searchParams.set('code', code);
        back.searchParams.set('state', p.get('state')!);
        return Response.redirect(back.toString(), 302);
      }
      if (url.pathname === '/token' && request.method === 'POST') {
        const form = new URLSearchParams(await request.text());
        const auth = request.headers.get('authorization');
        idp.tokenCalls.push({ auth, form });
        const basicOk = auth === `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`;
        const postOk = form.get('client_id') === CLIENT_ID && form.get('client_secret') === CLIENT_SECRET;
        if (!basicOk && !postOk) return Response.json({ error: 'invalid_client' }, { status: 401 });
        const issued = idp.codes.get(form.get('code') ?? '');
        idp.codes.delete(form.get('code') ?? '');
        if (!issued) return Response.json({ error: 'invalid_grant' }, { status: 400 });
        if (pkceChallenge(form.get('code_verifier') ?? '') !== issued.challenge) return Response.json({ error: 'pkce' }, { status: 400 });
        if (form.get('redirect_uri') !== issued.redirectUri) return Response.json({ error: 'redirect' }, { status: 400 });
        const idToken = await new SignJWT({ nonce: issued.nonce, ...issued.claims })
          .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
          .setIssuer(idp.issuer)
          .setAudience(idp.audience)
          .setSubject(String(issued.claims.sub ?? 'sub-1'))
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(privateKey);
        return Response.json({ access_token: 'at', token_type: 'Bearer', id_token: idToken });
      }
      return new Response('not found', { status: 404 });
    },
  });
  idp.issuer = `http://127.0.0.1:${idp.server.port}`;

  await import('../db');
  ({ usersStore } = await import('../users/store'));
  ({ oidcConfig } = await import('./oidc-config'));
  ({ signAccess } = await import('./tokens'));
  ({ clearOidcCaches } = await import('./oidc'));
  const licenseService = await import('../license/service');
  license = licenseService.license;
  const { encodeLicense } = await import('../license/key');
  const pair = generateKeyPairSync('ed25519');
  licenseService.setLicensePublicKeyForTests(pair.publicKey);
  licenseKey = encodeLicense({
    v: 1, id: 'test', licensee: 'Teste', edition: 'pro',
    issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  }, pair.privateKey);

  const { Elysia: ElysiaCtor } = await import('elysia');
  const { authRoutes } = await import('./routes');
  const { oidcRoutes } = await import('./oidc-routes');
  app = new ElysiaCtor().use(authRoutes).use(oidcRoutes) as unknown as Elysia;
});

afterAll(() => {
  idp.server?.stop(true);
  for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });
});

beforeEach(() => {
  idp.authMethods = ['client_secret_basic'];
  idp.audience = CLIENT_ID;
  idp.tokenCalls = [];
  clearOidcCaches();
});

const fullSettings = () => ({
  enabled: true, issuer: idp.issuer, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
  autoProvision: false, allowedDomains: [] as string[], adminGroup: '', disablePasswordLogin: false,
});

describe('OIDC sem licença', () => {
  it('config-public diz enabled:false mesmo configurado e login redireciona com erro', async () => {
    license.remove();
    oidcConfig.set(fullSettings());
    const pub = await (await app.handle(req('/api/auth/oidc/config-public'))).json();
    expect(pub).toEqual({ enabled: false, buttonLabel: 'Entrar com SSO', passwordLogin: true });

    const res = await app.handle(req('/api/auth/oidc/login'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/?sso_error=disabled');
  });

  it('escrita de configuração e teste exigem licença (402); leitura segue liberada ao admin', async () => {
    license.remove();
    const token = await tokenFor('root', 'admin');
    const put = await app.handle(req('/api/auth/oidc/settings', { method: 'PUT', token, body: { enabled: false } }));
    expect(put.status).toBe(402);
    expect(await put.json()).toEqual({ error: 'license_required', feature: 'sso' });
    const test = await app.handle(req('/api/auth/oidc/test', { method: 'POST', token, body: {} }));
    expect(test.status).toBe(402);
    const get = await app.handle(req('/api/auth/oidc/settings', { token }));
    expect(get.status).toBe(200);
  });

  it('usuário comum não acessa as configurações', async () => {
    const token = await tokenFor('comum', 'user');
    expect((await app.handle(req('/api/auth/oidc/settings', { token }))).status).toBe(403);
    expect((await app.handle(req('/api/auth/oidc/settings'))).status).toBe(401);
  });
});

describe('OIDC licenciado', () => {
  beforeAll(async () => {
    oidcConfig.clear();
    await installLicense();
  });

  it('salva configuração sem devolver o segredo e calcula a redirect URI', async () => {
    const token = await tokenFor('root', 'admin');
    const res = await app.handle(req('/api/auth/oidc/settings', { method: 'PUT', token, body: fullSettings() }));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.clientSecret).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(CLIENT_SECRET);
    expect(body.clientSecretSet).toBe(true);
    expect(body.redirectUri).toBe(`${APP}/api/auth/oidc/callback`);
    expect(body.scopes).toBe('openid email profile');

    const keep = await app.handle(req('/api/auth/oidc/settings', { method: 'PUT', token, body: { buttonLabel: 'Entrar com Google', clientSecret: '' } }));
    expect((await keep.json() as Record<string, unknown>).clientSecretSet).toBe(true);
    expect(oidcConfig.get().clientSecret).toBe(CLIENT_SECRET);
  });

  it('recusa habilitar sem issuer válido', async () => {
    const token = await tokenFor('root', 'admin');
    const res = await app.handle(req('/api/auth/oidc/settings', { method: 'PUT', token, body: { issuer: 'ftp://x' } }));
    expect(res.status).toBe(400);
  });

  it('respeita x-forwarded-proto/host ao montar a redirect URI', async () => {
    const token = await tokenFor('root', 'admin');
    const r = req('/api/auth/oidc/settings', { token });
    r.headers.set('x-forwarded-proto', 'https');
    r.headers.set('x-forwarded-host', 'files.corp.com');
    const body = await (await app.handle(r)).json() as Record<string, unknown>;
    expect(body.redirectUri).toBe('https://files.corp.com/api/auth/oidc/callback');
  });

  it('config-public reflete o botão configurado', async () => {
    const pub = await (await app.handle(req('/api/auth/oidc/config-public'))).json();
    expect(pub).toEqual({ enabled: true, buttonLabel: 'Entrar com Google', passwordLogin: true });
  });

  it('testar descoberta devolve os endpoints', async () => {
    const token = await tokenFor('root', 'admin');
    const res = await app.handle(req('/api/auth/oidc/test', { method: 'POST', token, body: {} }));
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.tokenEndpoint).toBe(`${idp.issuer}/token`);
    const bad = await app.handle(req('/api/auth/oidc/test', { method: 'POST', token, body: { issuer: 'http://127.0.0.1:1' } }));
    expect((await bad.json() as Record<string, unknown>).ok).toBe(false);
  });

  it('login monta authorize com code flow, PKCE S256, state e nonce, e prende o state num cookie lax', async () => {
    const res = await app.handle(req('/api/auth/oidc/login'));
    const location = new URL(res.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(`${idp.issuer}/authorize`);
    const p = location.searchParams;
    expect(p.get('response_type')).toBe('code');
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('redirect_uri')).toBe(`${APP}/api/auth/oidc/callback`);
    expect(p.get('scope')).toBe('openid email profile');
    expect(p.get('nonce')).toBeTruthy();
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('cs3_oidc='))!;
    expect(setCookie).toContain(`cs3_oidc=${p.get('state')}`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toContain('Path=/api/auth/oidc');
  });

  it('ida e volta completa: usuário existente recebe sessão e o refresh funciona', async () => {
    await tokenFor('ana', 'user');
    const res = await fullLogin({ preferred_username: 'ana', email: 'ana@corp.com' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
    const refreshCookie = cookiesOf(res).cs3_rt;
    expect(refreshCookie).toBeTruthy();
    expect(res.headers.getSetCookie().find((c) => c.startsWith('cs3_rt='))).toContain('Path=/api/auth');
    expect(idp.tokenCalls[0]!.auth).toStartWith('Basic ');

    const refresh = await app.handle(req('/api/auth/refresh', { method: 'POST', cookie: `cs3_rt=${refreshCookie}` }));
    expect(refresh.status).toBe(200);
    const body = await refresh.json() as { user: { username: string } };
    expect(body.user.username).toBe('ana');
    expect(usersStore.raw('ana')!.lastLogin).toBeTruthy();
  });

  it('usa client_secret_post quando é o único método anunciado', async () => {
    idp.authMethods = ['client_secret_post'];
    const res = await fullLogin({ preferred_username: 'ana' });
    expect(res.headers.get('location')).toBe('/');
    expect(idp.tokenCalls[0]!.auth).toBeNull();
    expect(idp.tokenCalls[0]!.form.get('client_secret')).toBe(CLIENT_SECRET);
  });

  it('state sem o cookie do navegador correspondente é recusado', async () => {
    const res = await fullLogin({ preferred_username: 'ana' }, 'forjado');
    expect(res.headers.get('location')).toBe('/?sso_error=state');
    expect(cookiesOf(res).cs3_rt).toBeUndefined();
  });

  it('state não pode ser reutilizado', async () => {
    const { authorize, stateCookie } = await startLogin();
    const back = await idpAuthorize(authorize, { preferred_username: 'ana' });
    const first = await app.handle(req(`/api/auth/oidc/callback${back.search}`, { cookie: `cs3_oidc=${stateCookie}` }));
    expect(first.headers.get('location')).toBe('/');
    const replay = await app.handle(req(`/api/auth/oidc/callback${back.search}`, { cookie: `cs3_oidc=${stateCookie}` }));
    expect(replay.headers.get('location')).toBe('/?sso_error=state');
  });

  it('id_token com audience errada é recusado', async () => {
    idp.audience = 'outro-cliente';
    const res = await fullLogin({ preferred_username: 'ana' });
    expect(res.headers.get('location')).toBe('/?sso_error=token');
  });

  it('erro devolvido pelo IdP vira sso_error=idp', async () => {
    const res = await app.handle(req('/api/auth/oidc/callback?error=access_denied&state=x', { cookie: 'cs3_oidc=x' }));
    expect(res.headers.get('location')).toBe('/?sso_error=idp');
  });

  it('usuário inexistente sem autoProvision é recusado', async () => {
    const res = await fullLogin({ preferred_username: 'desconhecido' });
    expect(res.headers.get('location')).toBe('/?sso_error=not_provisioned');
    expect(usersStore.exists('desconhecido')).toBe(false);
  });

  it('usuário desativado é recusado', async () => {
    await tokenFor('inativo', 'user');
    const { sqlite } = await import('../db');
    sqlite.run("UPDATE users SET active = 0 WHERE username = 'inativo'");
    const res = await fullLogin({ preferred_username: 'inativo' });
    expect(res.headers.get('location')).toBe('/?sso_error=inactive');
  });

  it('autoProvision cria a conta; adminGroup promove só na criação', async () => {
    oidcConfig.set({ autoProvision: true, adminGroup: 'cockpit-admins' });
    const plain = await fullLogin({ preferred_username: 'novo' });
    expect(plain.headers.get('location')).toBe('/');
    expect(usersStore.raw('novo')!.role).toBe('user');

    const boss = await fullLogin({ preferred_username: 'chefe', groups: ['cockpit-admins'] });
    expect(boss.headers.get('location')).toBe('/');
    expect(usersStore.raw('chefe')!.role).toBe('admin');

    const again = await fullLogin({ preferred_username: 'novo', groups: ['cockpit-admins'] });
    expect(again.headers.get('location')).toBe('/');
    expect(usersStore.raw('novo')!.role).toBe('user');
    oidcConfig.set({ autoProvision: false, adminGroup: '' });
  });

  it('allow-list de domínios bloqueia emails de fora', async () => {
    oidcConfig.set({ allowedDomains: ['corp.com'] });
    const outsider = await fullLogin({ preferred_username: 'ana', email: 'ana@gmail.com' });
    expect(outsider.headers.get('location')).toBe('/?sso_error=domain');
    const insider = await fullLogin({ preferred_username: 'ana', email: 'ana@corp.com' });
    expect(insider.headers.get('location')).toBe('/');
    oidcConfig.set({ allowedDomains: [] });
  });

  it('disablePasswordLogin bloqueia senha de não-admins e mantém admins como break-glass', async () => {
    await tokenFor('ana', 'user');
    await tokenFor('root', 'admin');
    oidcConfig.set({ disablePasswordLogin: true });
    const pub = await (await app.handle(req('/api/auth/oidc/config-public'))).json() as Record<string, unknown>;
    expect(pub.passwordLogin).toBe(false);

    const blocked = await app.handle(req('/api/login', { method: 'POST', body: { username: 'ana', password: 'senha12345' } }));
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: 'password_login_disabled' });
    expect(cookiesOf(blocked).cs3_rt).toBeUndefined();

    const wrong = await app.handle(req('/api/login', { method: 'POST', body: { username: 'ana', password: 'errada123' } }));
    expect(wrong.status).toBe(401);

    const admin = await app.handle(req('/api/login', { method: 'POST', body: { username: 'root', password: 'senha12345' } }));
    expect(admin.status).toBe(200);

    license.remove();
    const unlicensed = await app.handle(req('/api/login', { method: 'POST', body: { username: 'ana', password: 'senha12345' } }));
    expect(unlicensed.status).toBe(200);
    await installLicense();
    oidcConfig.set({ disablePasswordLogin: false });
  });
});
