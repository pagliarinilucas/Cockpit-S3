// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function snapshotToBuffer(dbPath: string, spoolDir?: string): Buffer {
  const dir = spoolDir ?? tmpdir();
  const tempPath = join(dir, `escrow-snap-${process.pid}-${randomUUID()}.sqlite`);

  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      db.run(`VACUUM INTO '${tempPath}'`);
    } finally {
      db.close();
    }
    return readFileSync(tempPath);
  } finally {
    rmSync(tempPath, { force: true });
  }
}
