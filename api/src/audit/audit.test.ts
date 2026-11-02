// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { randomUUID, generateKeyPairSync } from 'node:crypto';

const DB = join(tmpdir(), `cockpit-audit-${randomUUID()}.sqlite`);
process.env.DB_PATH = DB;
delete process.env.COCKPIT_LICENSE_KEY;
delete process.env.COCKPIT_LICENSE_FILE;

let activityRoutes: typeof import('./routes').activityRoutes;
let audit: typeof import('./store').audit;
let auditSettings: typeof import('./settings').auditSettings;
let pruneAuditLog: typeof import('./retention').pruneAuditLog;
let csvCell: typeof import('./export').csvCell;
let csvRow: typeof import('./export').csvRow;
let license: typeof import('../license/service').license;
let usersStore: typeof import('../users/store').usersStore;
let signAccess: typeof import('../auth/tokens').signAccess;
let sqlite: typeof import('../db').sqlite;
let licenseKey: string;

const RUN = randomUUID().slice(0, 8);
const actorA = `alice-${RUN}`;
const actorB = `bob-${RUN}`;

beforeAll(async () => {
  ({ sqlite } = await import('../db'));
  ({ activityRoutes } = await import('./routes'));
  ({ audit } = await import('./store'));
  ({ auditSettings } = await import('./settings'));
  ({ pruneAuditLog } = await import('./retention'));
  ({ csvCell, csvRow } = await import('./export'));
  const service = await import('../license/service');
  const key = await import('../license/key');
  ({ license } = service);
  ({ usersStore } = await import('../users/store'));
  ({ signAccess } = await import('../auth/tokens'));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  service.setLicensePublicKeyForTests(publicKey);
  licenseKey = key.encodeLicense({
    v: 1, id: `audit-${RUN}`, licensee: 'Teste', edition: 'pro',
    issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000 * 30).toISOString(),
  }, privateKey);
});

beforeEach(() => {
  license.remove();
});

afterAll(() => {
  license.remove();
  for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });
});

async function tokenFor(username: string, role: 'admin' | 'user'): Promise<string> {
  if (!usersStore.exists(username)) await usersStore.create(username, 'senha12345', role);
  return signAccess(username, role, usersStore.raw(username)!.tokenVersion);
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

function insertAt(action: string, actor: string, bucket: string, target: string, at: string): number {
  return Number(sqlite.prepare('INSERT INTO activity (action, actor, bucket, target, at) VALUES (?, ?, ?, ?, ?)')
    .run(action, actor, bucket, target, at).lastInsertRowid);
}

describe('GET /api/activity', () => {
  it('mantém o formato de array, inclui id e filtra por ator, ação e período', async () => {
    const token = await tokenFor(`adm-${RUN}`, 'admin');
    insertAt('upload', actorA, 'b1', 'old.txt', '2026-01-01T10:00:00.000Z');
    insertAt('delete', actorA, 'b1', 'mid.txt', '2026-02-01T10:00:00.000Z');
    insertAt('upload', actorB, 'b2', 'new.txt', '2026-03-01T10:00:00.000Z');

    const all = await (await activityRoutes.handle(req(`/activity?actor=${actorA}`, { token }))).json() as Array<Record<string, unknown>>;
    expect(Array.isArray(all)).toBe(true);
    expect(all.map((e) => e.target)).toEqual(['mid.txt', 'old.txt']);
    expect(typeof all[0]!.id).toBe('number');

    const uploads = await (await activityRoutes.handle(req(`/activity?actor=${actorA}&action=upload`, { token }))).json() as Array<Record<string, unknown>>;
    expect(uploads.map((e) => e.target)).toEqual(['old.txt']);

    const ranged = await (await activityRoutes.handle(req(
      `/activity?since=2026-01-15T00:00:00Z&until=2026-03-15T00:00:00Z&bucket=b2`, { token }))).json() as Array<Record<string, unknown>>;
    expect(ranged.map((e) => e.target)).toEqual(['new.txt']);
  });

  it('pagina por cursor before e respeita o teto de 1000', async () => {
    const token = await tokenFor(`adm-${RUN}`, 'admin');
    const actor = `pager-${RUN}`;
    for (let i = 0; i < 5; i++) insertAt('download', actor, 'b', `f${i}`, `2026-04-0${i + 1}T00:00:00.000Z`);
    const first = await (await activityRoutes.handle(req(`/activity?actor=${actor}&limit=2`, { token }))).json() as Array<{ id: number; target: string }>;
    expect(first.map((e) => e.target)).toEqual(['f4', 'f3']);
    const next = await (await activityRoutes.handle(req(`/activity?actor=${actor}&limit=2&before=${first[1]!.id}`, { token }))).json() as Array<{ target: string }>;
    expect(next.map((e) => e.target)).toEqual(['f2', 'f1']);
    sqlite.transaction(() => { for (let i = 0; i < 1005; i++) audit.log('download', `bulk-${RUN}`, 'b', `x${i}`); })();
    const capped = await (await activityRoutes.handle(req(`/activity?actor=bulk-${RUN}&limit=5000`, { token }))).json() as unknown[];
    expect(capped.length).toBe(1000);
  });

  it('data inválida → 400; sem token → 401', async () => {
    const token = await tokenFor(`adm-${RUN}`, 'admin');
    expect((await activityRoutes.handle(req('/activity?since=ontem', { token }))).status).toBe(400);
    expect((await activityRoutes.handle(req('/activity'))).status).toBe(401);
  });
});

describe('CSV', () => {
  it('escapa no padrão RFC 4180', () => {
    expect(csvCell('simples')).toBe('simples');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('diz "oi"')).toBe('"diz ""oi"""');
    expect(csvCell('linha\nnova')).toBe('"linha\nnova"');
  });

  it('neutraliza injeção de fórmula', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tcmd')).toBe("'\tcmd");
    expect(csvCell('\rcmd')).toBe(`"'\rcmd"`);
    expect(csvCell(42)).toBe('42');
  });

  it('linha termina em CRLF', () => {
    expect(csvRow({ id: 1, action: 'upload', actor: 'a', bucket: 'b', target: '=x', at: 't' })).toBe("1,t,upload,a,b,'=x\r\n");
  });
});

describe('GET /api/activity/export', () => {
  it('sem licença → 402; usuário comum → 403', async () => {
    const admin = await tokenFor(`adm-${RUN}`, 'admin');
    const plain = await tokenFor(`usr-${RUN}`, 'user');
    const res = await activityRoutes.handle(req('/activity/export?format=csv', { token: admin }));
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: 'license_required', feature: 'audit-export' });
    license.install(licenseKey);
    expect((await activityRoutes.handle(req('/activity/export', { token: plain }))).status).toBe(403);
  });

  it('com licença transmite todas as linhas em CSV, JSON e NDJSON', async () => {
    license.install(licenseKey);
    const token = await tokenFor(`adm-${RUN}`, 'admin');
    const actor = `exp-${RUN}`;
    sqlite.transaction(() => { for (let i = 0; i < 1200; i++) audit.log('upload', actor, 'bkt', i === 0 ? '=cmd|calc' : `file-${i}`); })();

    const csv = await activityRoutes.handle(req(`/activity/export?format=csv&actor=${actor}&since=2020-01-01`, { token }));
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.headers.get('content-disposition')).toMatch(/^attachment; filename="cockpit-audit-2020-01-01-\d{4}-\d{2}-\d{2}\.csv"$/);
    const lines = (await csv.text()).split('\r\n').filter(Boolean);
    expect(lines[0]).toBe('id,at,action,actor,bucket,target');
    expect(lines.length).toBe(1201);
    expect(lines[1]).toContain(`,'=cmd|calc`);

    const json = await activityRoutes.handle(req(`/activity/export?format=json&actor=${actor}`, { token }));
    const parsed = await json.json() as Array<{ target: string; id: number }>;
    expect(parsed.length).toBe(1200);
    expect(parsed[0]!.target).toBe('=cmd|calc');
    expect(parsed[1]!.id).toBeGreaterThan(parsed[0]!.id);

    const ndjson = await activityRoutes.handle(req(`/activity/export?format=ndjson&actor=${actor}`, { token }));
    const rows = (await ndjson.text()).trim().split('\n').map((l) => JSON.parse(l));
    expect(rows.length).toBe(1200);

    const empty = await activityRoutes.handle(req(`/activity/export?format=json&actor=ninguem-${RUN}`, { token }));
    expect(await empty.json()).toEqual([]);

    expect((await activityRoutes.handle(req('/activity/export?format=xml', { token }))).status).toBe(400);
  });
});

describe('configurações e retenção', () => {
  it('PUT exige licença; GET mascara segredos', async () => {
    const token = await tokenFor(`adm-${RUN}`, 'admin');
    const denied = await activityRoutes.handle(req('/audit/settings', { method: 'PUT', token, body: { retentionDays: 30 } }));
    expect(denied.status).toBe(402);

    license.install(licenseKey);
    const ok = await activityRoutes.handle(req('/audit/settings', {
      method: 'PUT', token, body: { retentionDays: 30, webhookUrl: '', webhookSecret: 's3cr3t' },
    }));
    expect(ok.status).toBe(200);
    const view = await (await activityRoutes.handle(req('/audit/settings', { token }))).json() as Record<string, unknown>;
    expect(view.retentionDays).toBe(30);
    expect(view.webhookSecretSet).toBe(true);
    expect(JSON.stringify(view)).not.toContain('s3cr3t');

    const bad = await activityRoutes.handle(req('/audit/settings', { method: 'PUT', token, body: { webhookUrl: 'ftp://x' } }));
    expect(bad.status).toBe(400);
    auditSettings.update({ retentionDays: 0, webhookSecret: '' });
  });

  it('remove eventos mais antigos que retentionDays só com licença', () => {
    const actor = `ret-${RUN}`;
    const now = new Date('2026-06-30T00:00:00.000Z');
    insertAt('upload', actor, 'b', 'velho', '2026-05-01T00:00:00.000Z');
    insertAt('upload', actor, 'b', 'recente', '2026-06-25T00:00:00.000Z');
    auditSettings.update({ retentionDays: 30 });

    expect(pruneAuditLog(now)).toBe(0);
    expect(audit.list({ actor }).length).toBe(2);

    license.install(licenseKey);
    expect(pruneAuditLog(now)).toBeGreaterThanOrEqual(1);
    expect(audit.list({ actor }).map((e) => e.target)).toEqual(['recente']);

    auditSettings.update({ retentionDays: 0 });
    insertAt('upload', actor, 'b', 'antiquissimo', '2000-01-01T00:00:00.000Z');
    expect(pruneAuditLog(now)).toBe(0);
  });
});
