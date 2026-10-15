// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { OidcSettings } from './oidc-config';
import type { Role } from '../types';

export interface DiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
  token_endpoint_auth_methods_supported?: string[];
  code_challenge_methods_supported?: string[];
}

export interface PendingLogin {
  nonce: string;
  verifier: string;
  redirectUri: string;
  expiresAt: number;
}

export const PENDING_TTL_MS = 10 * 60 * 1000;
const PENDING_MAX = 2000;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const CLOCK_TOLERANCE_S = 60;
const USERNAME_MAX = 64;

const base64url = (buf: Buffer) => buf.toString('base64url');

export function randomToken(bytes = 32): string {
  return base64url(randomBytes(bytes));
}

export function pkceChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomToken(48);
  return { verifier, challenge: pkceChallenge(verifier) };
}

const pending = new Map<string, PendingLogin>();

function prunePending(now: number) {
  for (const [state, entry] of pending) {
    if (entry.expiresAt <= now) pending.delete(state);
  }
  while (pending.size >= PENDING_MAX) {
    const oldest = pending.keys().next().value;
    if (oldest === undefined) break;
    pending.delete(oldest);
  }
}

export const pendingLogins = {
  begin(redirectUri: string, now = Date.now()): { state: string; nonce: string; challenge: string } {
    prunePending(now);
    const state = randomToken();
    const nonce = randomToken();
    const { verifier, challenge } = createPkce();
    pending.set(state, { nonce, verifier, redirectUri, expiresAt: now + PENDING_TTL_MS });
    return { state, nonce, challenge };
  },

  consume(state: string | undefined, boundState: string | undefined, now = Date.now()): PendingLogin | null {
    if (!state || !boundState || state !== boundState) return null;
    const entry = pending.get(state);
    if (!entry) return null;
    pending.delete(state);
    if (entry.expiresAt <= now) return null;
    return entry;
  },

  size(): number {
    return pending.size;
  },

  clear(): void {
    pending.clear();
  },
};

export function discoveryUrl(issuer: string): string {
  return `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
}

const sameIssuer = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

const discoveryCache = new Map<string, { doc: DiscoveryDocument; fetchedAt: number }>();
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export function clearOidcCaches(): void {
  discoveryCache.clear();
  jwksCache.clear();
}

function isDiscoveryDocument(value: unknown): value is DiscoveryDocument {
  if (!value || typeof value !== 'object') return false;
  const d = value as Record<string, unknown>;
  return typeof d.issuer === 'string'
    && typeof d.authorization_endpoint === 'string'
    && typeof d.token_endpoint === 'string'
    && typeof d.jwks_uri === 'string';
}

export async function fetchDiscovery(issuer: string, { fresh = false } = {}): Promise<DiscoveryDocument> {
  const cached = discoveryCache.get(issuer);
  if (!fresh && cached && Date.now() - cached.fetchedAt < DISCOVERY_TTL_MS) return cached.doc;
  const res = await fetch(discoveryUrl(issuer), {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`descoberta respondeu HTTP ${res.status}`);
  const doc: unknown = await res.json();
  if (!isDiscoveryDocument(doc)) throw new Error('documento de descoberta incompleto');
  if (!sameIssuer(doc.issuer, issuer)) throw new Error(`issuer divergente: ${doc.issuer}`);
  discoveryCache.set(issuer, { doc, fetchedAt: Date.now() });
  return doc;
}

export function authorizationUrl(
  doc: DiscoveryDocument,
  s: OidcSettings,
  params: { redirectUri: string; state: string; nonce: string; challenge: string },
): string {
  const url = new URL(doc.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', s.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', s.scopes);
  url.searchParams.set('state', params.state);
  url.searchParams.set('nonce', params.nonce);
  url.searchParams.set('code_challenge', params.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export type TokenAuthMethod = 'client_secret_basic' | 'client_secret_post';

export function chooseTokenAuthMethod(doc: DiscoveryDocument): TokenAuthMethod {
  const supported = doc.token_endpoint_auth_methods_supported;
  if (!supported || supported.length === 0 || supported.includes('client_secret_basic')) return 'client_secret_basic';
  if (supported.includes('client_secret_post')) return 'client_secret_post';
  return 'client_secret_basic';
}

export async function exchangeCode(
  doc: DiscoveryDocument,
  s: OidcSettings,
  code: string,
  login: PendingLogin,
): Promise<string> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: login.redirectUri,
    code_verifier: login.verifier,
  });
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json',
  };
  if (chooseTokenAuthMethod(doc) === 'client_secret_post') {
    form.set('client_id', s.clientId);
    if (s.clientSecret) form.set('client_secret', s.clientSecret);
  } else if (s.clientSecret) {
    const credentials = `${encodeURIComponent(s.clientId)}:${encodeURIComponent(s.clientSecret)}`;
    headers['authorization'] = `Basic ${Buffer.from(credentials).toString('base64')}`;
  } else {
    form.set('client_id', s.clientId);
  }
  const res = await fetch(doc.token_endpoint, {
    method: 'POST',
    headers,
    body: form.toString(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`token endpoint respondeu HTTP ${res.status}`);
  const body = await res.json() as { id_token?: unknown };
  if (typeof body.id_token !== 'string') throw new Error('resposta sem id_token');
  return body.id_token;
}

function jwksFor(uri: string) {
  let set = jwksCache.get(uri);
  if (!set) {
    set = createRemoteJWKSet(new URL(uri));
    jwksCache.set(uri, set);
  }
  return set;
}

export async function verifyIdToken(
  doc: DiscoveryDocument,
  clientId: string,
  idToken: string,
  expectedNonce: string,
): Promise<JWTPayload> {
  const { payload } = await jwtVerify(idToken, jwksFor(doc.jwks_uri), {
    issuer: doc.issuer,
    audience: clientId,
    clockTolerance: CLOCK_TOLERANCE_S,
    requiredClaims: ['sub', 'exp', 'iat'],
  });
  if (payload.nonce !== expectedNonce) throw new Error('nonce divergente');
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (audiences.length > 1 && payload.azp !== undefined && payload.azp !== clientId) {
    throw new Error('azp divergente');
  }
  return payload;
}

export type IdentityError = 'no_username' | 'domain' | 'not_provisioned' | 'inactive';

export type IdentityDecision =
  | { ok: true; username: string; provisionRole: Role | null }
  | { ok: false; error: IdentityError };

export interface ExistingAccount { active: boolean }

function claimString(claims: JWTPayload, name: string): string | null {
  const value = claims[name];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function resolveUsername(claims: JWTPayload, usernameClaim: string): string | null {
  const candidate = claimString(claims, usernameClaim) ?? claimString(claims, 'email');
  if (!candidate || candidate.length > USERNAME_MAX) return null;
  return candidate;
}

export function emailDomainAllowed(claims: JWTPayload, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true;
  const email = claimString(claims, 'email');
  if (!email || claims.email_verified === false) return false;
  const at = email.lastIndexOf('@');
  if (at < 1) return false;
  return allowedDomains.includes(email.slice(at + 1).toLowerCase());
}

export function groupsInclude(claims: JWTPayload, group: string): boolean {
  if (!group) return false;
  const groups = claims.groups;
  if (Array.isArray(groups)) return groups.some((g) => g === group);
  return typeof groups === 'string' && groups === group;
}

export function decideIdentity(
  claims: JWTPayload,
  s: Pick<OidcSettings, 'usernameClaim' | 'allowedDomains' | 'autoProvision' | 'adminGroup'>,
  lookup: (username: string) => ExistingAccount | null,
): IdentityDecision {
  if (!emailDomainAllowed(claims, s.allowedDomains)) return { ok: false, error: 'domain' };
  const username = resolveUsername(claims, s.usernameClaim);
  if (!username) return { ok: false, error: 'no_username' };
  const existing = lookup(username);
  if (existing) {
    if (!existing.active) return { ok: false, error: 'inactive' };
    return { ok: true, username, provisionRole: null };
  }
  if (!s.autoProvision) return { ok: false, error: 'not_provisioned' };
  return { ok: true, username, provisionRole: groupsInclude(claims, s.adminGroup) ? 'admin' : 'user' };
}
