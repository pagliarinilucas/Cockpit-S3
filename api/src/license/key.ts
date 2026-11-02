// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { createPublicKey, createPrivateKey, sign, verify, type KeyObject } from 'node:crypto';
import { RELEASE_DATE } from './release';

export type Edition = 'community' | 'pro' | 'enterprise';

export type ProFeature = 'sso' | 'audit-export' | 'branding';
export type EnterpriseFeature = 'white-label';
export type Feature = ProFeature | EnterpriseFeature;

export const PRO_FEATURES: readonly ProFeature[] = ['sso', 'audit-export', 'branding'];
export const ENTERPRISE_FEATURES: readonly Feature[] = [...PRO_FEATURES, 'white-label'];

export interface LicensePayload {
  v: 1;
  id: string;
  licensee: string;
  email?: string;
  edition: Exclude<Edition, 'community'>;
  instance?: string;
  issuedAt: string;
  expiresAt: string;
  features?: Feature[];
}

const KEY_PREFIX = 'CS3-';
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export function publicKeyFromRaw(raw: Buffer): KeyObject {
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

export function privateKeyFromSeed(seed: Buffer): KeyObject {
  return createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
}

export function encodeLicense(payload: LicensePayload, privateKey: KeyObject): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = sign(null, body, privateKey);
  return `${KEY_PREFIX}${body.toString('base64url')}.${signature.toString('base64url')}`;
}

export type DecodeResult =
  | { ok: true; payload: LicensePayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'unsupported' };

function isLicensePayload(value: unknown): value is LicensePayload {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return p.v === 1
    && typeof p.id === 'string'
    && typeof p.licensee === 'string'
    && (p.edition === 'pro' || p.edition === 'enterprise')
    && typeof p.issuedAt === 'string'
    && typeof p.expiresAt === 'string'
    && !Number.isNaN(Date.parse(p.expiresAt))
    && (p.features === undefined || Array.isArray(p.features));
}

export function decodeLicense(key: string, publicKey: KeyObject): DecodeResult {
  const trimmed = key.trim().replace(/\s+/g, '');
  if (!trimmed.startsWith(KEY_PREFIX)) return { ok: false, reason: 'malformed' };
  const [bodyPart, sigPart, ...rest] = trimmed.slice(KEY_PREFIX.length).split('.');
  if (!bodyPart || !sigPart || rest.length) return { ok: false, reason: 'malformed' };
  const body = Buffer.from(bodyPart, 'base64url');
  const signature = Buffer.from(sigPart, 'base64url');
  if (signature.length !== 64) return { ok: false, reason: 'malformed' };
  if (!verify(null, body, publicKey, signature)) return { ok: false, reason: 'bad_signature' };
  let parsed: unknown;
  try { parsed = JSON.parse(body.toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
  if (!isLicensePayload(parsed)) return { ok: false, reason: 'unsupported' };
  return { ok: true, payload: parsed };
}

export function featuresFor(payload: LicensePayload): Feature[] {
  const base = payload.edition === 'enterprise' ? ENTERPRISE_FEATURES : PRO_FEATURES;
  return [...new Set([...base, ...(payload.features ?? [])])];
}

export function evaluateLicense(payload: LicensePayload, now: Date, releaseDate = RELEASE_DATE) {
  const expires = new Date(payload.expiresAt);
  const coversRelease = new Date(`${releaseDate}T23:59:59Z`) <= expires;
  const expired = now > expires;
  return { expired, featuresActive: !expired || coversRelease };
}
