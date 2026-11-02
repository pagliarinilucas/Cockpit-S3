// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const DB = join(tmpdir(), `cockpit-demo-${randomUUID()}.sqlite`);
process.env.DB_PATH = DB;
process.env.ACCESS_TOKEN_SECRET ??= 'd'.repeat(48);

const { Elysia } = await import('elysia');
const { config } = await import('../config');
const { sqlite } = await import('../db');
const { usersStore } = await import('../users/store');
const { perms } = await import('../auth/permissions');
const { verifyPassword } = await import('../auth/passwords');
const catalog = await import('./catalog');
const { resetDemoData, runDemoReset, emptyDemoBucket } = await import('./reset');
type DemoStorage = import('./reset').DemoStorage;
const { demoRoutes } = await import('./routes');
const { demoShareTtl, isDemoBlockedRoute } = await import('./guard');

const originalDemo = structuredClone(config.demo);

function restoreDemoConfig(): void {
  Object.assign(config.demo, structuredClone(originalDemo));
}

afterEach(restoreDemoConfig);
afterAll(() => {
  restoreDemoConfig();
  for (const suffix of ['', '-wal', '-shm']) rmSync(DB + suffix, { force: true });
});

class MemoryStorage implements DemoStorage {
  readonly buckets = new Map<string, Map<string, Uint8Array>>();
  readonly touched: string[] = [];

  async ensureBucket(bucket: string) {
    this.touched.push(bucket);
    if (!this.buckets.has(bucket)) this.buckets.set(bucket, new Map());
  }
  async listKeys(bucket: string) {
    this.touched.push(bucket);
    return [...(this.buckets.get(bucket)?.keys() ?? [])];
  }
  async removeKeys(bucket: string, keys: string[]) {
    this.touched.push(bucket);
    for (const key of keys) this.buckets.get(bucket)?.delete(key);
  }
  async put(bucket: string, key: string, data: Uint8Array) {
    this.touched.push(bucket);
    if (!this.buckets.has(bucket)) this.buckets.set(bucket, new Map());
    this.buckets.get(bucket)!.set(key, data);
  }
}

const countRows = (table: string, where = '1 = 1') =>
  (sqlite.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n;

function enableDemo(): void {
  config.demo.enabled = true;
}

describe('demo reset', () => {
  let storage: MemoryStorage;

  beforeAll(async () => {
    if (config.dbPath !== DB) throw new Error(`demo reset test must own its database, got ${config.dbPath}`);
    config.demo.enabled = true;
    await usersStore.create('intruder', 'whatever123', 'admin');
    storage = new MemoryStorage();
    storage.buckets.set('acme-contracts', new Map([['stale/visitor-upload.bin', new Uint8Array([1, 2, 3])]]));
    await resetDemoData(storage, { manageClients: false });
    config.demo.enabled = false;
  });

  it('recreates exactly the demo accounts with the documented passwords', async () => {
    expect(usersStore.list().map((user) => user.username).sort()).toEqual(['admin', 'editor', 'viewer']);
    expect(usersStore.exists('intruder')).toBe(false);
    for (const account of catalog.DEMO_ACCOUNTS) {
      const row = usersStore.raw(account.username)!;
      expect(row.role).toBe(account.role);
      expect(await verifyPassword(account.password, row.passwordHash)).toBe(true);
    }
    expect(usersStore.get('editor')!.canShare).toBe(true);
    expect(usersStore.get('viewer')!.canShare).toBe(false);
  });

  it('seeds grants, a group, a folder override and a deny block', () => {
    expect(countRows('grants')).toBe(6);
    expect(countRows('groups')).toBe(1);
    expect(countRows('user_groups')).toBe(1);
    expect(countRows('user_blocks')).toBe(1);
    expect(countRows('connections')).toBe(1);

    const viewer = { username: 'viewer', role: 'user' as const };
    const editor = { username: 'editor', role: 'user' as const };
    const contracts = catalog.demoBucketId('acme-contracts');
    const marketing = catalog.demoBucketId('marketing-assets');
    const finance = catalog.demoBucketId('finance-reports');

    expect(perms.bucketPermFor(viewer, contracts)).toBe('view-only');
    expect(perms.bucketPermFor(viewer, marketing)).toBe('read-only');
    expect(perms.bucketPermFor(viewer, finance)).toBeNull();
    expect(perms.canRead(perms.access(viewer, contracts)!, 'legal-hold/litigation-notes.txt')).toBe(false);
    expect(perms.canDownload(perms.access(viewer, contracts)!, 'README.txt')).toBe(false);

    const editorFinance = perms.access(editor, finance)!;
    expect(perms.canWrite(editorFinance, 'drafts/notes.txt')).toBe(true);
    expect(perms.canWrite(editorFinance, '2026/budget.csv')).toBe(false);
    expect(perms.canDownload(editorFinance, '2026/budget.csv')).toBe(true);
  });

  it('seeds share links capped at one day, including expired, revoked and IP-locked ones', () => {
    const rows = sqlite.query('SELECT created_at, expires_at, revoked, lock_ip, bound_ip FROM shares').all() as
      { created_at: string; expires_at: string; revoked: number; lock_ip: number; bound_ip: string | null }[];
    const nowIso = new Date().toISOString();
    expect(rows.length).toBe(5);
    expect(rows.filter((row) => row.expires_at < nowIso).length).toBe(1);
    expect(rows.filter((row) => row.revoked === 1).length).toBe(1);
    expect(rows.filter((row) => row.lock_ip === 1).length).toBe(2);
    expect(rows.filter((row) => row.bound_ip !== null).length).toBe(1);
    for (const row of rows) {
      const ttlMs = Date.parse(row.expires_at) - Date.parse(row.created_at);
      expect(ttlMs).toBeLessThanOrEqual(catalog.MAX_DEMO_SHARE_TTL_SECONDS * 1000);
    }
  });

  it('writes a backdated activity timeline', () => {
    const total = countRows('activity');
    expect(total).toBeGreaterThanOrEqual(30);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    expect(countRows('activity', `at < '${weekAgo}'`)).toBeGreaterThan(0);
    const actors = sqlite.query('SELECT DISTINCT actor FROM activity').all() as { actor: string }[];
    expect(actors.map((row) => row.actor)).toEqual(expect.arrayContaining(['admin', 'editor', 'viewer']));
  });

  it('empties the demo buckets and refills them with the generated fixtures', () => {
    expect([...new Set(storage.touched)].sort()).toEqual([...catalog.DEMO_BUCKETS].sort());
    expect(storage.buckets.get('acme-contracts')!.has('stale/visitor-upload.bin')).toBe(false);
    for (const bucket of catalog.DEMO_BUCKETS) expect(storage.buckets.get(bucket)!.size).toBeGreaterThan(0);
    const contract = storage.buckets.get('acme-contracts')!.get('contracts/2026/master-services-agreement.pdf')!;
    expect(new TextDecoder().decode(contract.slice(0, 4))).toBe('%PDF');
    const workbook = storage.buckets.get('finance-reports')!.get('2026/q3-revenue.xlsx')!;
    expect(workbook[0]).toBe(0x50);
    expect(workbook[1]).toBe(0x4b);
  });

  it('is idempotent: a second reset yields the same counts', async () => {
    enableDemo();
    const summary = await resetDemoData(new MemoryStorage(), { manageClients: false });
    expect(summary.users).toBe(3);
    expect(countRows('users')).toBe(3);
    expect(countRows('grants')).toBe(summary.grants);
    expect(countRows('shares')).toBe(summary.shares);
    expect(countRows('activity')).toBe(summary.activity);
  });
});

describe('demo reset safety', () => {
  it('refuses to empty a bucket that is not part of the demo', async () => {
    const storage = new MemoryStorage();
    storage.buckets.set('production-backups', new Map([['db.dump', new Uint8Array([9])]]));
    await expect(emptyDemoBucket(storage, 'production-backups')).rejects.toThrow('non-demo bucket');
    expect(storage.touched).toEqual([]);
    expect(storage.buckets.get('production-backups')!.size).toBe(1);
  });

  it('never runs when DEMO_MODE is off', async () => {
    config.demo.enabled = false;
    const storage = new MemoryStorage();
    await expect(runDemoReset(storage, { manageClients: false })).rejects.toThrow('demo_mode_disabled');
    await expect(resetDemoData(storage, { manageClients: false })).rejects.toThrow('demo_mode_disabled');
    expect(storage.touched).toEqual([]);
  });

  it('serializes concurrent resets into a single run', async () => {
    enableDemo();
    const storage = new MemoryStorage();
    const first = runDemoReset(storage, { manageClients: false });
    const second = runDemoReset(storage, { manageClients: false });
    expect(second).toBe(first);
    await first;
    expect(storage.touched.filter((bucket) => bucket === 'finance-reports').length).toBeGreaterThan(0);
  });
});

function buildGuardedApp() {
  return new Elysia()
    .use(demoRoutes)
    .all('/api/*', () => ({ reached: true }));
}

function call(app: ReturnType<typeof buildGuardedApp>, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    (init.headers as Record<string, string>)['content-type'] ??= 'application/json';
  }
  return app.handle(new Request(`http://localhost${path}`, init));
}

const BLOCKED_REQUESTS: [string, string, unknown?][] = [
  ['POST', '/api/auth/password', { current: 'demo', next: 'hijacked1' }],
  ['POST', '/api/users/viewer/password', { password: 'hijacked1' }],
  ['DELETE', '/api/users/admin'],
  ['DELETE', '/api/users/viewer'],
  ['DELETE', '/api/users/editor'],
  ['POST', '/api/connections', {}],
  ['PUT', '/api/connections/cdemo', {}],
  ['DELETE', '/api/connections/cdemo'],
  ['POST', '/api/connections/test', {}],
  ['POST', '/api/clusters', {}],
  ['DELETE', '/api/clusters/kdemo'],
  ['POST', '/api/clusters/kdemo/keys', {}],
  ['GET', '/api/clusters/kdemo/keys/GK123/secret'],
  ['GET', '/api/kek'],
  ['POST', '/api/escrow/config', {}],
  ['POST', '/api/escrow/backup-now'],
  ['PUT', '/api/license', {}],
  ['DELETE', '/api/license'],
  ['PUT', '/api/auth/oidc/settings', {}],
  ['PUT', '/api/audit/settings', {}],
  ['POST', '/api/audit/test-forward'],
  ['PUT', '/api/branding/settings', {}],
  ['DELETE', '/api/branding/logo'],
  ['POST', '/api/buckets', { connectionId: 'cdemo', name: 'mine' }],
  ['DELETE', '/api/buckets/cdemo:acme-contracts'],
  ['PATCH', '/api/users/admin', { role: 'user' }],
];

const ALLOWED_REQUESTS: [string, string, unknown?][] = [
  ['GET', '/api/users'],
  ['GET', '/api/connections'],
  ['GET', '/api/escrow'],
  ['POST', '/api/auth/logout-all'],
  ['PATCH', '/api/users/editor', { canShare: false }],
  ['PATCH', '/api/users/admin', { role: 'admin' }],
  ['DELETE', '/api/users/someone-else'],
  ['PUT', '/api/users/viewer/grants', { bucketId: 'cdemo:finance-reports', perm: 'read-only' }],
  ['DELETE', '/api/buckets/cdemo:acme-contracts/objects', { keys: ['README.txt'] }],
  ['POST', '/api/shares', { bucketId: 'cdemo:marketing-assets', key: 'brand/logo.png', ttl: 3600 }],
];

describe('demo guardrails', () => {
  it('returns 403 demo_readonly for sensitive routes when demo mode is on', async () => {
    enableDemo();
    const app = buildGuardedApp();
    for (const [method, path, body] of BLOCKED_REQUESTS) {
      const res = await call(app, method, path, body);
      expect({ method, path, status: res.status }).toEqual({ method, path, status: 403 });
      expect(await res.json()).toEqual({ error: 'demo_readonly' });
    }
  });

  it('lets the regular demo workflow through when demo mode is on', async () => {
    enableDemo();
    const app = buildGuardedApp();
    for (const [method, path, body] of ALLOWED_REQUESTS) {
      const res = await call(app, method, path, body);
      expect({ method, path, status: res.status }).toEqual({ method, path, status: 200 });
    }
  });

  it('does not interfere with anything when demo mode is off', async () => {
    config.demo.enabled = false;
    const app = buildGuardedApp();
    for (const [method, path, body] of [...BLOCKED_REQUESTS, ...ALLOWED_REQUESTS]) {
      const res = await call(app, method, path, body);
      expect({ method, path, status: res.status }).toEqual({ method, path, status: 200 });
    }
    expect(demoShareTtl(2_592_000)).toBe(2_592_000);
  });

  it('caps upload size by the declared body length', async () => {
    enableDemo();
    config.demo.maxUploadBytes = 16;
    const app = buildGuardedApp();
    const big = await call(app, 'POST', '/api/buckets/cdemo:acme-contracts/objects-encrypted?name=a.bin', 'x'.repeat(64), {
      'content-type': 'application/octet-stream',
      'content-length': '64',
    });
    expect(big.status).toBe(413);
    expect(await big.json()).toEqual({ error: 'demo_upload_too_large', maxBytes: 16 });
    const small = await call(app, 'POST', '/api/buckets/cdemo:acme-contracts/objects-encrypted?name=a.bin', 'x'.repeat(8), {
      'content-type': 'application/octet-stream',
      'content-length': '8',
    });
    expect(small.status).toBe(200);
  });

  it('clamps share link lifetime to one day in demo mode', () => {
    enableDemo();
    expect(demoShareTtl(3600)).toBe(3600);
    expect(demoShareTtl(604_800)).toBe(catalog.MAX_DEMO_SHARE_TTL_SECONDS);
  });

  it('matches routes regardless of trailing slashes, encoding and HEAD', () => {
    expect(isDemoBlockedRoute('POST', '/api/connections/')).toBe(true);
    expect(isDemoBlockedRoute('HEAD', '/api/kek')).toBe(true);
    expect(isDemoBlockedRoute('DELETE', '/api/buckets/cdemo%3Aacme-contracts')).toBe(true);
    expect(isDemoBlockedRoute('OPTIONS', '/api/connections')).toBe(false);
    expect(isDemoBlockedRoute('GET', '/api/clusters')).toBe(false);
  });
});

describe('GET /api/demo', () => {
  it('reports enabled demo mode with the public accounts', async () => {
    enableDemo();
    config.demo.resetMinutes = 60;
    const res = await call(buildGuardedApp(), 'GET', '/api/demo');
    expect(res.status).toBe(200);
    const info = await res.json() as {
      enabled: boolean; resetMinutes: number; nextResetAt: string | null;
      accounts: { username: string; password: string; role: string; description: string }[];
    };
    expect(info.enabled).toBe(true);
    expect(info.resetMinutes).toBe(60);
    expect(info.nextResetAt === null || !Number.isNaN(Date.parse(info.nextResetAt))).toBe(true);
    expect(info.accounts.map((account) => account.username)).toEqual(['admin', 'editor', 'viewer']);
    for (const account of info.accounts) {
      expect(Object.keys(account).sort()).toEqual(['description', 'password', 'role', 'username']);
      expect(account.password).toBe('demo');
    }
  });

  it('only says disabled when demo mode is off', async () => {
    config.demo.enabled = false;
    const res = await call(buildGuardedApp(), 'GET', '/api/demo');
    expect(await res.json()).toEqual({ enabled: false });
  });
});
