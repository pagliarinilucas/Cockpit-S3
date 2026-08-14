// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync, writeFileSync } from 'node:fs';

const DB = join(tmpdir(), `cockpit-kek-${crypto.randomUUID()}.sqlite`);
const KEKFILE = join(tmpdir(), `cockpit-kek-${crypto.randomUUID()}.key`);
process.env.DB_PATH = DB;
// KEK de 32 bytes conhecidos, base64
const KEK_B64 = Buffer.alloc(32, 9).toString('base64');
writeFileSync(KEKFILE, KEK_B64);
process.env.COCKPIT_KEK_FILE = KEKFILE;

let mod: typeof import('./kek');
beforeAll(async () => { await import('../db'); mod = await import('./kek'); });
afterAll(() => {
  for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });
  rmSync(KEKFILE, { force: true });
});

describe('FileKekProvider', () => {
  it('inicializa, registra org_keys v1 e reporta status', () => {
    const p = mod.initFileKekProvider();
    expect(p.getCurrentVersion('default')).toBe(1);
    expect(p.status().sealed).toBe(false);
    expect(p.status().mode).toBe('plaintext_env');
  });

  it('wrap com a versão corrente e unwrap fecham o ciclo', () => {
    const p = mod.initFileKekProvider();
    const dek = Buffer.alloc(32, 3);
    const { wrapped, version } = p.wrapWithCurrent('default', dek);
    expect(p.unwrapDek('default', version, wrapped).equals(dek)).toBe(true);
  });

  it('KEK trocada (verifier não confere) aborta na init', async () => {
    // regrava o arquivo com outra KEK, mantendo o org_keys v1 já criado com a antiga
    writeFileSync(KEKFILE, Buffer.alloc(32, 1).toString('base64'));
    expect(() => mod.initFileKekProvider()).toThrow(/KEK/);
    writeFileSync(KEKFILE, KEK_B64); // restaura
  });
});
