// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EscrowDest } from './dest';
import { decryptBundle } from './bundle';

const SPOOL = join(tmpdir(), `escrow-backup-test-${randomUUID()}`);
mkdirSync(SPOOL, { recursive: true });

const KEK_FILE = join(SPOOL, 'kek.bin');
writeFileSync(KEK_FILE, Buffer.alloc(32, 7));
process.env.COCKPIT_KEK_FILE = KEK_FILE;

const DB = join(tmpdir(), `cockpit-escrow-backup-${randomUUID()}.sqlite`);
process.env.DB_PATH = DB;

let escrowStore: typeof import('./store').escrowStore;
let runBackupOnce: typeof import('./backup').runBackupOnce;

beforeAll(async () => {
  await import('../db');
  ({ escrowStore } = await import('./store'));
  ({ runBackupOnce } = await import('./backup'));
});

afterAll(() => {
  for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });
  rmSync(SPOOL, { recursive: true, force: true });
  rmSync(SRC_DB, { force: true });
});

const SRC_DB = join(tmpdir(), `escrow-backup-src-${randomUUID()}.sqlite`);

function makeSourceDb(): void {
  const db = new Database(SRC_DB);
  db.run('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
  db.run("INSERT INTO items (name) VALUES ('alpha')");
  db.run("INSERT INTO items (name) VALUES ('beta')");
  db.close();
}

function memoryDest(): EscrowDest & { map: Map<string, Buffer> } {
  const map = new Map<string, Buffer>();
  return {
    map,
    async put(key: string, body: Buffer): Promise<void> {
      map.set(key, body);
    },
    async list() {
      return [...map.entries()].map(([key, buf]) => ({
        key,
        at: Number(key.slice(7, 21)),
        size: buf.length,
      }));
    },
    async get(key: string): Promise<Buffer> {
      const buf = map.get(key);
      if (!buf) throw new Error('not_found');
      return buf;
    },
    async del(keys: string[]): Promise<void> {
      for (const k of keys) map.delete(k);
    },
    async test(): Promise<void> {},
  };
}

const RECOVERY_SECRET = 'correct-horse-battery-staple';

describe('runBackupOnce', () => {
  it('produz um bundle que decripta de volta para o banco original', async () => {
    makeSourceDb();
    const dest = memoryDest();
    const T = Date.parse('2026-01-01T00:00:00.000Z');

    const result = await runBackupOnce({
      dest,
      dbPath: SRC_DB,
      recoverySecret: RECOVERY_SECRET,
      vendorPub: null,
      now: T,
      spoolDir: SPOOL,
    });

    expect(dest.map.size).toBe(1);
    expect(result.key).toBe([...dest.map.keys()][0] ?? '');
    expect(result.removed).toBe(0);

    const blob = await dest.get(result.key);
    const { dbBytes } = await decryptBundle(blob, { recoverySecret: RECOVERY_SECRET });

    const outPath = join(SPOOL, `restored-${randomUUID()}.sqlite`);
    writeFileSync(outPath, dbBytes);
    const outDb = new Database(outPath, { readonly: true });
    const rows = outDb.query('SELECT name FROM items ORDER BY id').all() as { name: string }[];
    outDb.close();
    rmSync(outPath, { force: true });

    expect(rows.map((r) => r.name)).toEqual(['alpha', 'beta']);
  });

  it('aplica retenção ao longo de várias chamadas e reporta removed > 0', async () => {
    const dest = memoryDest();
    const T = Date.parse('2026-02-01T00:00:00.000Z');
    const DAY = 86_400_000;

    const r1 = await runBackupOnce({
      dest, dbPath: SRC_DB, recoverySecret: RECOVERY_SECRET, vendorPub: null, now: T, spoolDir: SPOOL,
    });
    expect(r1.removed).toBe(0);
    expect((await dest.list()).length).toBe(1);

    const r2 = await runBackupOnce({
      dest, dbPath: SRC_DB, recoverySecret: RECOVERY_SECRET, vendorPub: null, now: T + 8 * DAY, spoolDir: SPOOL,
    });
    expect(r2.removed).toBeGreaterThan(0);
    expect((await dest.list()).length).toBe(1);

    const r3 = await runBackupOnce({
      dest, dbPath: SRC_DB, recoverySecret: RECOVERY_SECRET, vendorPub: null, now: T + 38 * DAY, spoolDir: SPOOL,
    });
    expect(r3.removed).toBeGreaterThan(0);
    expect((await dest.list()).length).toBe(1);
  });

  it('grava status ok no escrowStore', async () => {
    const dest = memoryDest();
    const T = Date.parse('2026-03-01T00:00:00.000Z');

    await runBackupOnce({
      dest, dbPath: SRC_DB, recoverySecret: RECOVERY_SECRET, vendorPub: null, now: T, spoolDir: SPOOL,
    });

    const cfg = escrowStore.get();
    expect(cfg.lastStatus).toBe('ok');
    expect(cfg.lastError).toBeNull();
    expect(cfg.lastCount).toBeGreaterThan(0);
  });
});
