// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const DB = join(tmpdir(), `cockpit-escrow-routes-${randomUUID()}.sqlite`);
process.env.DB_PATH = DB;

let escrowRoutes: typeof import('./routes').escrowRoutes;
let escrowStore: typeof import('./store').escrowStore;
let usersStore: typeof import('../users/store').usersStore;
let signAccess: typeof import('../auth/tokens').signAccess;

beforeAll(async () => {
  await import('../db');
  ({ escrowRoutes } = await import('./routes'));
  ({ escrowStore } = await import('./store'));
  ({ usersStore } = await import('../users/store'));
  ({ signAccess } = await import('../auth/tokens'));
  escrowStore.setConfig({ enabled: false, clientDest: null, vendorEnabled: false });
});

afterAll(() => { for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true }); });

async function tokenFor(username: string, role: 'admin' | 'user'): Promise<string> {
  if (!usersStore.exists(username)) await usersStore.create(username, 'senha12345', role);
  const raw = usersStore.raw(username)!;
  return signAccess(username, role, raw.tokenVersion);
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

describe('escrow routes', () => {
  it('GET /escrow sem admin → 403', async () => {
    const token = await tokenFor('userplain', 'user');
    const res = await escrowRoutes.handle(req('/escrow', { token }));
    expect(res.status).toBe(403);
  });

  it('GET /escrow sem token → 401', async () => {
    const res = await escrowRoutes.handle(req('/escrow'));
    expect(res.status).toBe(401);
  });

  it('recovery: gera código, GET reflete recoverySet/recoveryShown, ack marca mostrado, nunca vaza o segredo', async () => {
    const token = await tokenFor('adminone', 'admin');

    const genRes = await escrowRoutes.handle(req('/escrow/recovery', { method: 'POST', token, body: {} }));
    expect(genRes.status).toBe(200);
    const gen = await genRes.json() as { code: string };
    expect(typeof gen.code).toBe('string');
    expect(gen.code.length).toBeGreaterThan(0);

    const statusRes = await escrowRoutes.handle(req('/escrow', { token }));
    const status = await statusRes.json() as Record<string, unknown>;
    expect(status.recoverySet).toBe(true);
    expect(status.recoveryShown).toBe(false);
    expect(JSON.stringify(status)).not.toContain(gen.code);
    expect(status.recoverySecret).toBeUndefined();

    const ackRes = await escrowRoutes.handle(req('/escrow/recovery/ack', { method: 'POST', token }));
    expect(ackRes.status).toBe(200);
    const ack = await ackRes.json() as Record<string, unknown>;
    expect(ack.ok).toBe(true);

    const status2Res = await escrowRoutes.handle(req('/escrow', { token }));
    const status2 = await status2Res.json() as Record<string, unknown>;
    expect(status2.recoveryShown).toBe(true);
  });

  it('recovery: segredo manual curto → 400 weak_secret', async () => {
    const token = await tokenFor('adminweak', 'admin');
    const res = await escrowRoutes.handle(req('/escrow/recovery', { method: 'POST', token, body: { manual: 'curto' } }));
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('weak_secret');
  });

  it('backup-now sem config → 400 not_configured', async () => {
    const token = await tokenFor('admintwo', 'admin');
    const res = await escrowRoutes.handle(req('/escrow/backup-now', { method: 'POST', token }));
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('not_configured');
  });

  it('test sem clientDest configurado → 400 no_dest', async () => {
    const token = await tokenFor('adminthree', 'admin');
    const res = await escrowRoutes.handle(req('/escrow/test', { method: 'POST', token }));
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('no_dest');
  });

  it('config: define clientDest e GET nunca devolve secretKey', async () => {
    const token = await tokenFor('adminfour', 'admin');
    const cfgRes = await escrowRoutes.handle(req('/escrow/config', {
      method: 'POST', token,
      body: {
        enabled: true,
        vendorEnabled: false,
        clientDest: {
          endpoint: 'https://s3.example.com', region: 'us-east-1',
          accessKey: 'ak', secretKey: 'super-secret-key', bucket: 'escrow-bucket', prefix: 'org/',
        },
      },
    }));
    expect(cfgRes.status).toBe(200);
    const status = await cfgRes.json() as Record<string, unknown>;
    expect(status.enabled).toBe(true);
    expect(status.clientDest).toEqual({
      endpoint: 'https://s3.example.com', region: 'us-east-1', accessKey: 'ak', bucket: 'escrow-bucket', prefix: 'org/',
    });
    expect(JSON.stringify(status)).not.toContain('super-secret-key');
  });
});
