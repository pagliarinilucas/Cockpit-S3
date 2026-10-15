// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { randomUUID, generateKeyPairSync, type KeyObject } from 'node:crypto';

const DB = join(tmpdir(), `cockpit-branding-${randomUUID()}.sqlite`);
process.env.DB_PATH = DB;
delete process.env.COCKPIT_LICENSE_KEY;
delete process.env.COCKPIT_LICENSE_FILE;

let brandingRoutes: typeof import('./routes').brandingRoutes;
let brandingStore: typeof import('./store').brandingStore;
let license: typeof import('../license/service').license;
let encodeLicense: typeof import('../license/key').encodeLicense;
let usersStore: typeof import('../users/store').usersStore;
let signAccess: typeof import('../auth/tokens').signAccess;
let privateKey: KeyObject;

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('0000000d49484452000000010000000108060000001f15c489', 'hex'),
]);
const PNG = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;

function licenseFor(edition: 'pro' | 'enterprise'): string {
  return encodeLicense({
    v: 1, id: `brand-${edition}`, licensee: 'Teste', edition,
    issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000 * 30).toISOString(),
  }, privateKey);
}

beforeAll(async () => {
  await import('../db');
  ({ brandingRoutes } = await import('./routes'));
  ({ brandingStore } = await import('./store'));
  const service = await import('../license/service');
  ({ license } = service);
  ({ encodeLicense } = await import('../license/key'));
  ({ usersStore } = await import('../users/store'));
  ({ signAccess } = await import('../auth/tokens'));
  const pair = generateKeyPairSync('ed25519');
  privateKey = pair.privateKey;
  service.setLicensePublicKeyForTests(pair.publicKey);
});

beforeEach(() => {
  license.remove();
});

afterAll(() => {
  license.remove();
  for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });
});

async function adminToken(): Promise<string> {
  const username = 'brand-admin';
  if (!usersStore.exists(username)) await usersStore.create(username, 'senha12345', 'admin');
  return signAccess(username, 'admin', usersStore.raw(username)!.tokenVersion);
}

function req(path: string, opts: { method?: string; token?: string; body?: unknown } = {}): Request {
  const headers: Record<string, string> = {};
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`http://localhost/api${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

async function put(body: unknown): Promise<Response> {
  return brandingRoutes.handle(req('/branding/settings', { method: 'PUT', token: await adminToken(), body }));
}

describe('branding', () => {
  it('PUT sem licença → 402', async () => {
    const res = await put({ productName: 'ACME Drive' });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: 'license_required', feature: 'branding' });
  });

  it('GET público devolve padrão sem licença mesmo com valores salvos', async () => {
    license.install(licenseFor('pro'));
    expect((await put({ productName: 'ACME Drive', accentColor: '#FF0055', logo: PNG, sharePageMessage: 'Olá' })).status).toBe(200);

    const active = await (await brandingRoutes.handle(req('/branding'))).json() as Record<string, unknown>;
    expect(active).toMatchObject({ active: true, productName: 'ACME Drive', accentColor: '#ff0055', logo: PNG, sharePageMessage: 'Olá' });

    license.remove();
    const reverted = await (await brandingRoutes.handle(req('/branding'))).json() as Record<string, unknown>;
    expect(reverted).toEqual({
      active: false, productName: 'Cockpit S3', accentColor: null, logo: null, sharePageMessage: '', hidePoweredBy: false,
    });
    expect(brandingStore.get().productName).toBe('ACME Drive');
  });

  it('valida a imagem do logo', async () => {
    license.install(licenseFor('pro'));
    const svg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64')}`;
    expect(await (await put({ logo: svg })).json()).toEqual({ error: 'logo_type' });

    const fakePng = `data:image/png;base64,${Buffer.from('<html>not a png</html>').toString('base64')}`;
    expect(await (await put({ logo: fakePng })).json()).toEqual({ error: 'logo_invalid' });

    expect(await (await put({ logo: 'https://evil.example/logo.png' })).json()).toEqual({ error: 'logo_invalid' });

    const huge = `data:image/png;base64,${Buffer.concat([PNG_BYTES, Buffer.alloc(256 * 1024)]).toString('base64')}`;
    const tooBig = await put({ logo: huge });
    expect(tooBig.status).toBe(413);

    const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]).toString('base64')}`;
    expect((await put({ logo: jpeg })).status).toBe(200);

    expect((await put({ accentColor: 'red' })).status).toBe(400);

    const removed = await brandingRoutes.handle(req('/branding/logo', { method: 'DELETE', token: await adminToken() }));
    expect((await removed.json() as Record<string, unknown>).logo).toBeNull();
  });

  it('hidePoweredBy só vale com white-label (Enterprise)', async () => {
    license.install(licenseFor('pro'));
    await put({ hidePoweredBy: true });
    expect(brandingStore.get().hidePoweredBy).toBe(false);

    license.install(licenseFor('enterprise'));
    await put({ hidePoweredBy: true });
    expect((await (await brandingRoutes.handle(req('/branding'))).json() as Record<string, unknown>).hidePoweredBy).toBe(true);

    license.install(licenseFor('pro'));
    expect((await (await brandingRoutes.handle(req('/branding'))).json() as Record<string, unknown>).hidePoweredBy).toBe(false);
  });

  it('settings exige admin', async () => {
    expect((await brandingRoutes.handle(req('/branding/settings'))).status).toBe(401);
  });
});
