// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, it, expect, afterEach } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EscrowDest } from './dest';
import { encryptBundle } from './bundle';
import { restoreFrom } from './restore';

const SPOOL = join(tmpdir(), `escrow-restore-test-${randomUUID()}`);
mkdirSync(SPOOL, { recursive: true });

afterEach(() => {
  for (const f of ['kek.b64', 'db.sqlite']) {
    rmSync(join(SPOOL, f), { force: true });
  }
});

function memoryDest(): EscrowDest & { map: Map<string, Buffer> } {
  const map = new Map<string, Buffer>();
  return {
    map,
    async put(key: string, body: Buffer): Promise<void> {
      map.set(key, body);
    },
    async list() {
      return [...map.entries()]
        .map(([key, buf]) => ({ key, at: Number(key.slice(7, 21)), size: buf.length }))
        .sort((a, b) => b.at - a.at);
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

function keyFor(at: number): string {
  return `escrow-${String(at).padStart(14, '0')}-${randomUUID().slice(0, 8)}.bin`;
}

const RECOVERY_SECRET = 'correct-horse-battery-staple';

describe('restoreFrom', () => {
  it('cai para o snapshot anterior quando o mais novo está corrompido', async () => {
    const dest = memoryDest();
    const kek = Buffer.alloc(32, 9);
    const dbBytesOld = Buffer.from('banco antigo integro');
    const dbBytesNew = Buffer.from('banco novo corrompido');

    const oldKey = keyFor(1_000);
    const newKey = keyFor(2_000);

    const oldBlob = await encryptBundle({ kek, dbBytes: dbBytesOld }, { recoverySecret: RECOVERY_SECRET });
    const newBlobGood = await encryptBundle({ kek, dbBytes: dbBytesNew }, { recoverySecret: RECOVERY_SECRET });
    const newBlobCorrupt = Buffer.from(newBlobGood);
    newBlobCorrupt[newBlobCorrupt.length - 1] = (newBlobCorrupt[newBlobCorrupt.length - 1] ?? 0) ^ 0xff;

    await dest.put(oldKey, oldBlob);
    await dest.put(newKey, newBlobCorrupt);

    const kekOutPath = join(SPOOL, 'kek.b64');
    const dbOutPath = join(SPOOL, 'db.sqlite');

    const result = await restoreFrom({
      dest,
      opener: { recoverySecret: RECOVERY_SECRET },
      kekOutPath,
      dbOutPath,
      force: false,
    });

    expect(result.from).toBe(oldKey);
    expect(result.restoredKek).toBe(true);
    expect(readFileSync(dbOutPath)).toEqual(dbBytesOld);
    expect(Buffer.from(readFileSync(kekOutPath, 'utf8'), 'base64')).toEqual(kek);
  });

  it('recusa sobrescrever sem force e sobrescreve com force', async () => {
    const dest = memoryDest();
    const kek = Buffer.alloc(32, 3);
    const dbBytes = Buffer.from('banco unico');
    const key = keyFor(5_000);
    const blob = await encryptBundle({ kek, dbBytes }, { recoverySecret: RECOVERY_SECRET });
    await dest.put(key, blob);

    const kekOutPath = join(SPOOL, 'kek.b64');
    const dbOutPath = join(SPOOL, 'db.sqlite');
    writeFileSync(dbOutPath, 'banco existente');

    await expect(
      restoreFrom({ dest, opener: { recoverySecret: RECOVERY_SECRET }, kekOutPath, dbOutPath, force: false }),
    ).rejects.toThrow('escrow_refuse_overwrite');

    expect(existsSync(kekOutPath)).toBe(false);

    const result = await restoreFrom({
      dest,
      opener: { recoverySecret: RECOVERY_SECRET },
      kekOutPath,
      dbOutPath,
      force: true,
    });

    expect(result.from).toBe(key);
    expect(readFileSync(dbOutPath)).toEqual(dbBytes);
    expect(Buffer.from(readFileSync(kekOutPath, 'utf8'), 'base64')).toEqual(kek);
  });

  it('bundle sem KEK grava só o banco e não exige kekOutPath', async () => {
    const dest = memoryDest();
    const dbBytes = Buffer.from('banco sem kek');
    const key = keyFor(9_000);
    const blob = await encryptBundle({ kek: null, dbBytes }, { recoverySecret: RECOVERY_SECRET });
    await dest.put(key, blob);

    const kekOutPath = join(SPOOL, 'kek.b64');
    const dbOutPath = join(SPOOL, 'db.sqlite');

    const result = await restoreFrom({
      dest,
      opener: { recoverySecret: RECOVERY_SECRET },
      kekOutPath,
      dbOutPath,
      force: false,
    });

    expect(result.restoredKek).toBe(false);
    expect(result.from).toBe(key);
    expect(readFileSync(dbOutPath)).toEqual(dbBytes);
    expect(existsSync(kekOutPath)).toBe(false);
  });

  it('lança escrow_no_snapshots quando o destino está vazio', async () => {
    const dest = memoryDest();
    const kekOutPath = join(SPOOL, 'kek.b64');
    const dbOutPath = join(SPOOL, 'db.sqlite');

    await expect(
      restoreFrom({ dest, opener: { recoverySecret: RECOVERY_SECRET }, kekOutPath, dbOutPath, force: false }),
    ).rejects.toThrow('escrow_no_snapshots');
  });

  it('lança escrow_restore_failed quando nenhum snapshot decifra', async () => {
    const dest = memoryDest();
    const key = keyFor(1_500);
    await dest.put(key, Buffer.from('lixo nao decifravel'));

    const kekOutPath = join(SPOOL, 'kek.b64');
    const dbOutPath = join(SPOOL, 'db.sqlite');

    await expect(
      restoreFrom({ dest, opener: { recoverySecret: RECOVERY_SECRET }, kekOutPath, dbOutPath, force: false }),
    ).rejects.toThrow('escrow_restore_failed');
  });
});
