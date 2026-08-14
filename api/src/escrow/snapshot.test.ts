// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotToBuffer } from './snapshot';

test('gera snapshot consistente de um sqlite em disco', () => {
  const spoolDir = join(tmpdir(), `escrow-snapshot-test-${randomUUID()}`);
  const srcPath = join(spoolDir, `src-${randomUUID()}.sqlite`);
  const outPath = join(spoolDir, `out-${randomUUID()}.sqlite`);

  mkdirSync(spoolDir, { recursive: true });

  try {
    const db = new Database(srcPath);
    db.run('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
    db.run("INSERT INTO items (name) VALUES ('a')");
    db.run("INSERT INTO items (name) VALUES ('b')");
    db.run("INSERT INTO items (name) VALUES ('c')");
    db.close();

    const bytes = snapshotToBuffer(srcPath, spoolDir);
    expect(bytes.length).toBeGreaterThan(0);

    writeFileSync(outPath, bytes);
    const outDb = new Database(outPath, { readonly: true });
    const row = outDb.query('SELECT COUNT(*) as n FROM items').get() as { n: number };
    expect(row.n).toBe(3);
    outDb.close();

    const leftover = readdirSync(spoolDir).filter((f) => f.startsWith('escrow-snap-'));
    expect(leftover).toEqual([]);
  } finally {
    rmSync(spoolDir, { recursive: true, force: true });
  }
});
