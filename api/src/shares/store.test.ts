import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

// Isola o teste num DB temporário próprio (o db.ts lê DB_PATH no import).
const DB_FILE = join(tmpdir(), `cockpit-shares-test-${crypto.randomUUID()}.sqlite`);
process.env.DB_PATH = DB_FILE;

// Import dinâmico DEPOIS de setar DB_PATH, para o db.ts abrir o arquivo isolado.
const { sharesStore, isUsable } = await import('./store');
const { db } = await import('../db');
const { users } = await import('../db/schema');

beforeAll(() => {
  db.insert(users).values({
    username: 'tester',
    passwordHash: 'x',
    role: 'user',
    createdAt: new Date().toISOString(),
  }).run();
});

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(DB_FILE + suffix); } catch { /* ignore */ }
  }
});

const mk = (over: Partial<{ revoked: number; expiresAt: string }> = {}) => ({
  revoked: 0,
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  ...over,
});

describe('isUsable', () => {
  const now = new Date().toISOString();
  it('link válido (não revogado, não expirado) → true', () => {
    expect(isUsable(mk(), now)).toBe(true);
  });
  it('link expirado → false', () => {
    expect(isUsable(mk({ expiresAt: new Date(Date.now() - 1000).toISOString() }), now)).toBe(false);
  });
  it('link revogado → false', () => {
    expect(isUsable(mk({ revoked: 1 }), now)).toBe(false);
  });
});

describe('create', () => {
  it('gera token único e suficientemente longo (>=128 bits)', () => {
    const a = sharesStore.create({ bucketId: 'c:b', key: 'a.txt', createdBy: 'tester', ttlSec: 3600, lockIp: false });
    const b = sharesStore.create({ bucketId: 'c:b', key: 'b.txt', createdBy: 'tester', ttlSec: 3600, lockIp: false });
    expect(a.token).not.toBe(b.token);
    // base64url de 32 bytes → 43 chars; muito acima de 22 (~128 bits)
    expect(a.token.length).toBeGreaterThanOrEqual(43);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it('expiresAt fica no futuro conforme ttl', () => {
    const s = sharesStore.create({ bucketId: 'c:b', key: 'x.txt', createdBy: 'tester', ttlSec: 3600, lockIp: false });
    expect(new Date(s.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('bindIpIfUnset', () => {
  it('1º acesso grava o IP; 2º com IP diferente NÃO sobrescreve', () => {
    const s = sharesStore.create({ bucketId: 'c:b', key: 'y.txt', createdBy: 'tester', ttlSec: 3600, lockIp: true });
    const first = sharesStore.bindIpIfUnset(s.token, '1.1.1.1');
    expect(first).toBe('1.1.1.1');
    const second = sharesStore.bindIpIfUnset(s.token, '2.2.2.2');
    expect(second).toBe('1.1.1.1'); // permanece o primeiro
    expect(sharesStore.get(s.token)?.boundIp).toBe('1.1.1.1');
  });
});

describe('revoke', () => {
  it('marca o link como revogado', () => {
    const s = sharesStore.create({ bucketId: 'c:b', key: 'z.txt', createdBy: 'tester', ttlSec: 3600, lockIp: false });
    sharesStore.revoke(s.token);
    const row = sharesStore.get(s.token)!;
    expect(row.revoked).toBe(1);
    expect(isUsable(row, new Date().toISOString())).toBe(false);
  });
});

describe('listByUser', () => {
  it('retorna só os links do usuário com status derivado', () => {
    const list = sharesStore.listByUser('tester');
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((s) => typeof s.status === 'string')).toBe(true);
    expect(list.every((s) => s.token && s.bucketId === 'c:b')).toBe(true);
  });
});
