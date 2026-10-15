// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { readFileSync } from 'node:fs';
import type { KeyObject } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { settings } from '../db/schema';
import { decodeLicense, evaluateLicense, featuresFor, publicKeyFromRaw, type Edition, type Feature } from './key';
import { LICENSE_PUBKEY_B64 } from './pubkey';
import { RELEASE_DATE } from './release';

const SETTINGS_KEY = 'license_key';

export type LicenseState = 'none' | 'active' | 'expired' | 'invalid';
export type LicenseSource = 'env' | 'database' | null;

export interface LicenseStatus {
  edition: Edition;
  state: LicenseState;
  source: LicenseSource;
  licensee: string | null;
  email: string | null;
  instance: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  updatesUntil: string | null;
  releaseDate: string;
  features: Feature[];
  error: string | null;
}

let publicKey: KeyObject = publicKeyFromRaw(Buffer.from(LICENSE_PUBKEY_B64, 'base64'));
let cached: LicenseStatus | null = null;

export function setLicensePublicKeyForTests(key: KeyObject) {
  publicKey = key;
  cached = null;
}

function envKey(): string | null {
  const file = process.env.COCKPIT_LICENSE_FILE;
  if (file) return readFileSync(file, 'utf8').trim() || null;
  return process.env.COCKPIT_LICENSE_KEY?.trim() || null;
}

function storedKey(): string | null {
  const row = db.select({ value: settings.value }).from(settings).where(eq(settings.key, SETTINGS_KEY)).get();
  return row?.value ?? null;
}

function emptyStatus(state: LicenseState, source: LicenseSource, error: string | null): LicenseStatus {
  return {
    edition: 'community', state, source, licensee: null, email: null, instance: null,
    issuedAt: null, expiresAt: null, updatesUntil: null, releaseDate: RELEASE_DATE, features: [], error,
  };
}

export function statusForKey(key: string | null, source: LicenseSource, now = new Date()): LicenseStatus {
  if (!key) return emptyStatus('none', null, null);
  const decoded = decodeLicense(key, publicKey);
  if (!decoded.ok) return emptyStatus('invalid', source, decoded.reason);
  const { payload } = decoded;
  const { expired, featuresActive } = evaluateLicense(payload, now);
  return {
    edition: featuresActive ? payload.edition : 'community',
    state: expired ? 'expired' : 'active',
    source,
    licensee: payload.licensee,
    email: payload.email ?? null,
    instance: payload.instance ?? null,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    updatesUntil: payload.expiresAt,
    releaseDate: RELEASE_DATE,
    features: featuresActive ? featuresFor(payload) : [],
    error: null,
  };
}

export const license = {
  status(): LicenseStatus {
    if (cached && cached.state !== 'active') return cached;
    if (cached && cached.expiresAt && new Date() <= new Date(cached.expiresAt)) return cached;
    const fromEnv = envKey();
    cached = fromEnv ? statusForKey(fromEnv, 'env') : statusForKey(storedKey(), 'database');
    return cached;
  },
  has(feature: Feature): boolean {
    return license.status().features.includes(feature);
  },
  install(key: string): LicenseStatus {
    const candidate = statusForKey(key, 'database');
    if (candidate.state === 'invalid') return candidate;
    const value = key.trim().replace(/\s+/g, '');
    db.insert(settings).values({ key: SETTINGS_KEY, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run();
    cached = null;
    return license.status();
  },
  remove(): void {
    db.delete(settings).where(eq(settings.key, SETTINGS_KEY)).run();
    cached = null;
  },
};

type FeatureGuardCtx = { set: { status?: number | string } };

export const requireFeature = (feature: Feature) => (ctx: unknown): unknown => {
  if (license.has(feature)) return undefined;
  (ctx as FeatureGuardCtx).set.status = 402;
  return { error: 'license_required', feature };
};
