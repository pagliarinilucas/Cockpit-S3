// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { settings } from '../db/schema';
import { config } from '../config';
import { license } from '../license/service';
import type { Role } from '../types';

export interface OidcSettings {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  buttonLabel: string;
  usernameClaim: string;
  autoProvision: boolean;
  allowedDomains: string[];
  adminGroup: string;
  disablePasswordLogin: boolean;
}

export type OidcSettingsPublic = Omit<OidcSettings, 'clientSecret'> & { clientSecretSet: boolean };

export type OidcSettingsInput = Partial<OidcSettings>;

export const OIDC_DEFAULTS: OidcSettings = {
  enabled: false,
  issuer: '',
  clientId: '',
  clientSecret: '',
  scopes: 'openid email profile',
  buttonLabel: 'Entrar com SSO',
  usernameClaim: 'preferred_username',
  autoProvision: false,
  allowedDomains: [],
  adminGroup: '',
  disablePasswordLogin: false,
};

const SETTINGS_KEY = 'oidc';

export function normalizeDomains(domains: string[]): string[] {
  const cleaned = domains
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
  return [...new Set(cleaned)];
}

export function normalizeScopes(scopes: string): string {
  const parts = scopes.split(/[\s,]+/).filter(Boolean);
  if (!parts.includes('openid')) parts.unshift('openid');
  return [...new Set(parts)].join(' ');
}

export function isValidIssuer(issuer: string): boolean {
  try {
    const url = new URL(issuer);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export const oidcConfig = {
  get(): OidcSettings {
    const row = db.select({ value: settings.value }).from(settings).where(eq(settings.key, SETTINGS_KEY)).get();
    if (!row) return { ...OIDC_DEFAULTS };
    try {
      return { ...OIDC_DEFAULTS, ...(JSON.parse(row.value) as Partial<OidcSettings>) };
    } catch {
      return { ...OIDC_DEFAULTS };
    }
  },

  set(input: OidcSettingsInput): OidcSettings {
    const current = this.get();
    const next: OidcSettings = { ...current };
    if (input.enabled !== undefined) next.enabled = input.enabled;
    if (input.issuer !== undefined) next.issuer = input.issuer.trim();
    if (input.clientId !== undefined) next.clientId = input.clientId.trim();
    if (input.clientSecret) next.clientSecret = input.clientSecret;
    if (input.scopes !== undefined) next.scopes = normalizeScopes(input.scopes || OIDC_DEFAULTS.scopes);
    if (input.buttonLabel !== undefined) next.buttonLabel = input.buttonLabel.trim() || OIDC_DEFAULTS.buttonLabel;
    if (input.usernameClaim !== undefined) next.usernameClaim = input.usernameClaim.trim() || OIDC_DEFAULTS.usernameClaim;
    if (input.autoProvision !== undefined) next.autoProvision = input.autoProvision;
    if (input.allowedDomains !== undefined) next.allowedDomains = normalizeDomains(input.allowedDomains);
    if (input.adminGroup !== undefined) next.adminGroup = input.adminGroup.trim();
    if (input.disablePasswordLogin !== undefined) next.disablePasswordLogin = input.disablePasswordLogin;
    const value = JSON.stringify(next);
    db.insert(settings).values({ key: SETTINGS_KEY, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run();
    return next;
  },

  clear(): void {
    db.delete(settings).where(eq(settings.key, SETTINGS_KEY)).run();
  },

  toPublic(s: OidcSettings): OidcSettingsPublic {
    const { clientSecret, ...rest } = s;
    return { ...rest, clientSecretSet: !!clientSecret };
  },
};

export function isConfigured(s: OidcSettings): boolean {
  return s.enabled && isValidIssuer(s.issuer) && !!s.clientId;
}

export function ssoActive(s: OidcSettings = oidcConfig.get()): boolean {
  return isConfigured(s) && license.has('sso');
}

export function passwordLoginAllowed(role: Role | null, s: OidcSettings = oidcConfig.get()): boolean {
  if (role === 'admin') return true;
  return !(s.disablePasswordLogin && ssoActive(s));
}

export function publicOidcInfo() {
  const s = oidcConfig.get();
  const enabled = ssoActive(s);
  return {
    enabled,
    buttonLabel: s.buttonLabel || OIDC_DEFAULTS.buttonLabel,
    passwordLogin: !(enabled && s.disablePasswordLogin),
  };
}

type HeaderBag = Record<string, string | undefined>;

export function publicBaseUrl(headers: HeaderBag, requestUrl: string): string {
  if (config.publicUrl) return config.publicUrl.replace(/\/+$/, '');
  const url = new URL(requestUrl);
  const proto = headers['x-forwarded-proto']?.split(',')[0]?.trim() || url.protocol.replace(/:$/, '');
  const host = headers['x-forwarded-host']?.split(',')[0]?.trim() || headers['host'] || url.host;
  return `${proto}://${host}`;
}

export const OIDC_CALLBACK_PATH = '/api/auth/oidc/callback';

export function redirectUriFor(headers: HeaderBag, requestUrl: string): string {
  return `${publicBaseUrl(headers, requestUrl)}${OIDC_CALLBACK_PATH}`;
}
