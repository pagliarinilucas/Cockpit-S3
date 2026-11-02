// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  createPkce, pkceChallenge, pendingLogins, PENDING_TTL_MS, decideIdentity, resolveUsername,
  emailDomainAllowed, groupsInclude, chooseTokenAuthMethod, discoveryUrl, type DiscoveryDocument,
} from './oidc';

const baseSettings = { usernameClaim: 'preferred_username', allowedDomains: [] as string[], autoProvision: false, adminGroup: '' };
const nobody = () => null;

describe('PKCE', () => {
  it('gera verifier de 64 chars base64url e challenge S256 conforme RFC 7636', () => {
    const { verifier, challenge } = createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(challenge).toBe(pkceChallenge(verifier));
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('cada chamada produz um par diferente', () => {
    expect(createPkce().verifier).not.toBe(createPkce().verifier);
  });
});

describe('state pendente', () => {
  beforeEach(() => pendingLogins.clear());

  it('consome uma única vez quando o cookie confere', () => {
    const { state, nonce } = pendingLogins.begin('https://app/cb');
    const entry = pendingLogins.consume(state, state);
    expect(entry?.nonce).toBe(nonce);
    expect(entry?.redirectUri).toBe('https://app/cb');
    expect(pendingLogins.consume(state, state)).toBeNull();
  });

  it('recusa quando o cookie do navegador não confere (login CSRF)', () => {
    const { state } = pendingLogins.begin('https://app/cb');
    expect(pendingLogins.consume(state, undefined)).toBeNull();
    expect(pendingLogins.consume(state, 'outro')).toBeNull();
    expect(pendingLogins.consume(undefined, state)).toBeNull();
  });

  it('recusa state desconhecido ou expirado', () => {
    expect(pendingLogins.consume('inventado', 'inventado')).toBeNull();
    const t0 = Date.now();
    const { state } = pendingLogins.begin('https://app/cb', t0);
    expect(pendingLogins.consume(state, state, t0 + PENDING_TTL_MS + 1)).toBeNull();
  });

  it('descarta expirados ao iniciar novos logins', () => {
    const t0 = Date.now();
    pendingLogins.begin('https://app/cb', t0);
    pendingLogins.begin('https://app/cb', t0 + PENDING_TTL_MS + 1);
    expect(pendingLogins.size()).toBe(1);
  });
});

describe('resolução de usuário', () => {
  it('usa a claim configurada e cai para email', () => {
    expect(resolveUsername({ preferred_username: ' ana ', email: 'ana@x.com' }, 'preferred_username')).toBe('ana');
    expect(resolveUsername({ email: 'ana@x.com' }, 'preferred_username')).toBe('ana@x.com');
    expect(resolveUsername({ upn: 'ana@corp' }, 'upn')).toBe('ana@corp');
    expect(resolveUsername({ sub: '123' }, 'preferred_username')).toBeNull();
    expect(resolveUsername({ preferred_username: 'x'.repeat(65) }, 'preferred_username')).toBeNull();
  });

  it('allow-list de domínios exige email verificado do domínio', () => {
    expect(emailDomainAllowed({}, [])).toBe(true);
    expect(emailDomainAllowed({ email: 'a@Corp.com' }, ['corp.com'])).toBe(true);
    expect(emailDomainAllowed({ email: 'a@corp.com', email_verified: false }, ['corp.com'])).toBe(false);
    expect(emailDomainAllowed({ email: 'a@evil.com' }, ['corp.com'])).toBe(false);
    expect(emailDomainAllowed({ email: 'a@sub.corp.com' }, ['corp.com'])).toBe(false);
    expect(emailDomainAllowed({}, ['corp.com'])).toBe(false);
  });

  it('groups aceita array ou string', () => {
    expect(groupsInclude({ groups: ['a', 'admins'] }, 'admins')).toBe(true);
    expect(groupsInclude({ groups: 'admins' }, 'admins')).toBe(true);
    expect(groupsInclude({ groups: ['a'] }, 'admins')).toBe(false);
    expect(groupsInclude({ groups: ['admins'] }, '')).toBe(false);
  });

  it('sem autoProvision só entra quem já existe e está ativo', () => {
    const claims = { preferred_username: 'ana' };
    expect(decideIdentity(claims, baseSettings, nobody)).toEqual({ ok: false, error: 'not_provisioned' });
    expect(decideIdentity(claims, baseSettings, () => ({ active: false }))).toEqual({ ok: false, error: 'inactive' });
    expect(decideIdentity(claims, baseSettings, () => ({ active: true }))).toEqual({ ok: true, username: 'ana', provisionRole: null });
  });

  it('com autoProvision cria como user, ou admin quando o grupo confere', () => {
    const s = { ...baseSettings, autoProvision: true, adminGroup: 'cockpit-admins' };
    expect(decideIdentity({ preferred_username: 'ana' }, s, nobody)).toEqual({ ok: true, username: 'ana', provisionRole: 'user' });
    expect(decideIdentity({ preferred_username: 'bia', groups: ['cockpit-admins'] }, s, nobody))
      .toEqual({ ok: true, username: 'bia', provisionRole: 'admin' });
    expect(decideIdentity({ preferred_username: 'bia', groups: ['cockpit-admins'] }, s, () => ({ active: true })))
      .toEqual({ ok: true, username: 'bia', provisionRole: null });
  });

  it('domínio fora da lista é recusado antes de qualquer outra regra', () => {
    const s = { ...baseSettings, autoProvision: true, allowedDomains: ['corp.com'] };
    expect(decideIdentity({ preferred_username: 'ana', email: 'ana@gmail.com' }, s, () => ({ active: true })))
      .toEqual({ ok: false, error: 'domain' });
    expect(decideIdentity({ email: 'ana@corp.com' }, s, nobody)).toEqual({ ok: true, username: 'ana@corp.com', provisionRole: 'user' });
  });

  it('sem nenhuma claim de nome → no_username', () => {
    expect(decideIdentity({ sub: 'x' }, baseSettings, nobody)).toEqual({ ok: false, error: 'no_username' });
  });
});

describe('descoberta', () => {
  const doc = (methods?: string[]): DiscoveryDocument => ({
    issuer: 'https://idp', authorization_endpoint: 'a', token_endpoint: 't', jwks_uri: 'j',
    token_endpoint_auth_methods_supported: methods,
  });

  it('prefere client_secret_basic (padrão da especificação) e usa post quando é o único', () => {
    expect(chooseTokenAuthMethod(doc())).toBe('client_secret_basic');
    expect(chooseTokenAuthMethod(doc(['client_secret_post', 'client_secret_basic']))).toBe('client_secret_basic');
    expect(chooseTokenAuthMethod(doc(['client_secret_post']))).toBe('client_secret_post');
  });

  it('monta a URL de descoberta sem barra dupla', () => {
    expect(discoveryUrl('https://auth.x/application/o/cockpit/')).toBe('https://auth.x/application/o/cockpit/.well-known/openid-configuration');
    expect(discoveryUrl('https://accounts.google.com')).toBe('https://accounts.google.com/.well-known/openid-configuration');
  });
});
