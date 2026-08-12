// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync, writeFileSync, readFileSync } from 'node:fs';

const RUN = !!process.env.ESCROW_TEST_ENDPOINT;
const KEKFILE = join(tmpdir(), `e2e-kek-${crypto.randomUUID()}.key`);
const APPDB = join(tmpdir(), `e2e-appdb-${crypto.randomUUID()}.sqlite`);
process.env.DB_PATH = APPDB;
const KEK_B64 = Buffer.alloc(32, 7).toString('base64');
writeFileSync(KEKFILE, KEK_B64);
process.env.COCKPIT_KEK_FILE = KEKFILE;

describe.skipIf(!RUN)('escrow e2e (MinIO real)', () => {
  const srcDb = join(tmpdir(), `e2e-src-${crypto.randomUUID()}.sqlite`);
  const kekOut = join(tmpdir(), `e2e-kekout-${crypto.randomUUID()}.key`);
  const dbOut = join(tmpdir(), `e2e-dbout-${crypto.randomUUID()}.sqlite`);
  const prefix = `e2e-${process.pid}-${crypto.randomUUID().slice(0, 8)}/`;

  beforeAll(() => {
    const db = new Database(srcDb);
    db.run('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    db.run("INSERT INTO t (v) VALUES ('alfa'), ('beta'), ('gama')");
    db.close();
  });
  afterAll(() => {
    for (const f of [srcDb, kekOut, dbOut, KEKFILE, APPDB]) {
      for (const s of ['', '-wal', '-shm']) rmSync(f + s, { force: true });
    }
  });

  it('backup → restore devolve KEK e banco idênticos', async () => {
    const { s3Dest } = await import('./dest');
    const { runBackupOnce } = await import('./backup');
    const { restoreFrom } = await import('./restore');

    const dest = s3Dest({
      endpoint: process.env.ESCROW_TEST_ENDPOINT!,
      region: process.env.ESCROW_TEST_REGION || 'us-east-1',
      accessKey: process.env.ESCROW_TEST_KEY!,
      secretKey: process.env.ESCROW_TEST_SECRET!,
      bucket: process.env.ESCROW_TEST_BUCKET!,
      prefix,
    });

    const secret = 'codigo-de-recuperacao-forte-123';
    const res = await runBackupOnce({ dest, dbPath: srcDb, recoverySecret: secret, vendorPub: null, now: 1_700_000_000_000 });
    expect(res.key).toContain('escrow-');

    const out = await restoreFrom({ dest, opener: { recoverySecret: secret }, kekOutPath: kekOut, dbOutPath: dbOut, force: true });
    expect(out.restoredKek).toBe(true);
    expect(out.from).toBe(res.key);

    expect(readFileSync(kekOut, 'utf8')).toBe(KEK_B64);
    const restored = new Database(dbOut, { readonly: true });
    const rows = restored.query('SELECT v FROM t ORDER BY id').all() as { v: string }[];
    restored.close();
    expect(rows.map((r) => r.v)).toEqual(['alfa', 'beta', 'gama']);

    await dest.del((await dest.list()).map((o) => o.key));
  });
});
