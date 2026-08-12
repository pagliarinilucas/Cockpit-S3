// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import type { DestConfig } from './dest';

const DB = join(tmpdir(), `cockpit-escrow-${crypto.randomUUID()}.sqlite`);
process.env.DB_PATH = DB;

let escrowStore: typeof import('./store').escrowStore;

beforeAll(async () => {
  await import('../db');
  ({ escrowStore } = await import('./store'));
});
afterAll(() => { for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true }); });

const dest: DestConfig = {
  endpoint: 'https://s3.example.com', region: 'us-east-1', accessKey: 'ak', secretKey: 'sk',
  bucket: 'escrow-bucket', prefix: 'org1/',
};

describe('escrowStore', () => {
  it('get() retorna default quando vazio', () => {
    const cfg = escrowStore.get();
    expect(cfg).toEqual({
      enabled: false, clientDest: null, vendorEnabled: false, recoverySecret: null,
      recoveryShown: false, lastBackupAt: null, lastStatus: null, lastError: null, lastCount: 0,
    });
  });

  it('setConfig + get: roundtrip incluindo clientDest JSON', () => {
    escrowStore.setConfig({ enabled: true, clientDest: dest, vendorEnabled: true });
    const cfg = escrowStore.get();
    expect(cfg.enabled).toBe(true);
    expect(cfg.vendorEnabled).toBe(true);
    expect(cfg.clientDest).toEqual(dest);
  });

  it('setConfig parcial preserva os demais campos', () => {
    escrowStore.setConfig({ enabled: true, clientDest: dest, vendorEnabled: false });
    escrowStore.setConfig({ enabled: false });
    const cfg = escrowStore.get();
    expect(cfg.enabled).toBe(false);
    expect(cfg.vendorEnabled).toBe(false);
    expect(cfg.clientDest).toEqual(dest);
  });

  it('setRecovery grava o segredo e zera recoveryShown', () => {
    escrowStore.markShown();
    escrowStore.setRecovery('recovery-code-123');
    const cfg = escrowStore.get();
    expect(cfg.recoverySecret).toBe('recovery-code-123');
    expect(cfg.recoveryShown).toBe(false);
  });

  it('markShown() marca recoveryShown como true', () => {
    escrowStore.setRecovery('another-code');
    escrowStore.markShown();
    expect(escrowStore.get().recoveryShown).toBe(true);
  });

  it('setStatus persiste last_backup_at/status/error/count', () => {
    escrowStore.setStatus({ at: '2026-08-11T12:00:00.000Z', status: 'ok', error: null, count: 42 });
    const cfg = escrowStore.get();
    expect(cfg.lastBackupAt).toBe('2026-08-11T12:00:00.000Z');
    expect(cfg.lastStatus).toBe('ok');
    expect(cfg.lastError).toBeNull();
    expect(cfg.lastCount).toBe(42);
  });

  it('setStatus com erro persiste last_error', () => {
    escrowStore.setStatus({ at: '2026-08-11T13:00:00.000Z', status: 'error', error: 'boom', count: 0 });
    const cfg = escrowStore.get();
    expect(cfg.lastStatus).toBe('error');
    expect(cfg.lastError).toBe('boom');
    expect(cfg.lastCount).toBe(0);
  });
});
