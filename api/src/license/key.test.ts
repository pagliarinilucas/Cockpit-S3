// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { test, expect } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { decodeLicense, encodeLicense, evaluateLicense, featuresFor, publicKeyFromRaw, privateKeyFromSeed, type LicensePayload } from './key';
import { LICENSE_PUBKEY_B64 } from './pubkey';

const payload: LicensePayload = {
  v: 1, id: 'lic-1', licensee: 'ACME', edition: 'pro',
  issuedAt: '2026-10-01T00:00:00.000Z', expiresAt: '2027-10-01T00:00:00.000Z',
};

function pair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey, publicKey };
}

test('chave assinada decodifica com a chave pública correspondente', () => {
  const { privateKey, publicKey } = pair();
  const decoded = decodeLicense(encodeLicense(payload, privateKey), publicKey);
  expect(decoded).toEqual({ ok: true, payload });
});

test('chave de outro emissor é rejeitada', () => {
  const signer = pair();
  const other = pair();
  expect(decodeLicense(encodeLicense(payload, signer.privateKey), other.publicKey)).toEqual({ ok: false, reason: 'bad_signature' });
});

test('payload adulterado invalida a assinatura', () => {
  const { privateKey, publicKey } = pair();
  const key = encodeLicense(payload, privateKey);
  const [body, sig] = key.slice(4).split('.');
  const forged = JSON.parse(Buffer.from(body!, 'base64url').toString());
  forged.edition = 'enterprise';
  const tampered = `CS3-${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}`;
  expect(decodeLicense(tampered, publicKey)).toEqual({ ok: false, reason: 'bad_signature' });
});

test('lixo e espaços/quebras de linha', () => {
  const { privateKey, publicKey } = pair();
  expect(decodeLicense('nada', publicKey)).toEqual({ ok: false, reason: 'malformed' });
  const key = encodeLicense(payload, privateKey);
  const wrapped = key.match(/.{1,40}/g)!.join('\n  ');
  expect(decodeLicense(wrapped, publicKey).ok).toBe(true);
});

test('seed e chave pública cruas reconstroem o par', () => {
  const { privateKey, publicKey } = pair();
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const key = encodeLicense(payload, privateKeyFromSeed(seed));
  expect(decodeLicense(key, publicKeyFromRaw(raw)).ok).toBe(true);
});

test('chave pública embutida é Ed25519 válida', () => {
  expect(() => publicKeyFromRaw(Buffer.from(LICENSE_PUBKEY_B64, 'base64'))).not.toThrow();
});

test('features por edição', () => {
  expect(featuresFor(payload)).toEqual(['sso', 'audit-export', 'branding']);
  expect(featuresFor({ ...payload, edition: 'enterprise' })).toContain('white-label');
  expect(featuresFor({ ...payload, features: ['white-label'] })).toContain('white-label');
});

test('licença expirada mantém recursos em releases cobertos pela vigência', () => {
  const after = new Date('2028-01-01T00:00:00Z');
  expect(evaluateLicense(payload, after, '2027-06-01')).toEqual({ expired: true, featuresActive: true });
  expect(evaluateLicense(payload, after, '2027-12-01')).toEqual({ expired: true, featuresActive: false });
  expect(evaluateLicense(payload, new Date('2027-01-01T00:00:00Z'), '2027-12-01')).toEqual({ expired: false, featuresActive: true });
});
