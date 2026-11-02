// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { test, expect, beforeAll, beforeEach } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeLicense, type LicensePayload } from './key';

process.env.DB_PATH ??= join(mkdtempSync(join(tmpdir(), 'cockpit-license-')), 'db.sqlite');
delete process.env.COCKPIT_LICENSE_KEY;
delete process.env.COCKPIT_LICENSE_FILE;

const { license, requireFeature, setLicensePublicKeyForTests } = await import('./service');
const { privateKey, publicKey } = generateKeyPairSync('ed25519');

const payload = (overrides: Partial<LicensePayload> = {}): LicensePayload => ({
  v: 1, id: 'lic-test', licensee: 'ACME', edition: 'pro',
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  ...overrides,
});

beforeAll(() => setLicensePublicKeyForTests(publicKey));
beforeEach(() => license.remove());

test('sem licença roda como Community', () => {
  expect(license.status()).toMatchObject({ edition: 'community', state: 'none', features: [] });
  expect(license.has('sso')).toBe(false);
});

test('instalar chave válida liga os recursos Pro', () => {
  const status = license.install(encodeLicense(payload(), privateKey));
  expect(status).toMatchObject({ edition: 'pro', state: 'active', source: 'database', licensee: 'ACME' });
  expect(license.has('sso')).toBe(true);
  expect(license.has('white-label')).toBe(false);
});

test('chave inválida não é gravada', () => {
  license.install(encodeLicense(payload(), privateKey));
  const other = generateKeyPairSync('ed25519');
  expect(license.install(encodeLicense(payload(), other.privateKey)).state).toBe('invalid');
  expect(license.status().edition).toBe('pro');
});

test('licença expirada que não cobre o release volta a Community', () => {
  license.install(encodeLicense(payload({ expiresAt: '2020-01-01T00:00:00.000Z' }), privateKey));
  expect(license.status()).toMatchObject({ edition: 'community', state: 'expired', features: [] });
});

test('variável de ambiente tem precedência sobre o banco', () => {
  license.install(encodeLicense(payload(), privateKey));
  process.env.COCKPIT_LICENSE_KEY = encodeLicense(payload({ edition: 'enterprise' }), privateKey);
  license.remove();
  try {
    expect(license.status()).toMatchObject({ edition: 'enterprise', source: 'env' });
  } finally {
    delete process.env.COCKPIT_LICENSE_KEY;
    license.remove();
  }
});

test('requireFeature responde 402 sem licença e libera com licença', () => {
  const ctx = { set: {} as { status?: number } };
  expect(requireFeature('audit-export')(ctx)).toEqual({ error: 'license_required', feature: 'audit-export' });
  expect(ctx.set.status).toBe(402);
  license.install(encodeLicense(payload(), privateKey));
  expect(requireFeature('audit-export')({ set: {} })).toBeUndefined();
});
