// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, it, expect } from 'bun:test';
import { normCluster, desiredPermCalls, garageAdmin, type RawStatus, type RawHealth, type RawStats } from './admin';

describe('normCluster', () => {
  it('funde status+health+stats em um resumo', () => {
    const status: RawStatus = { layoutVersion: 1, nodes: [{ id: 'n1', garageVersion: 'v2.3.0', addr: '10.0.0.1:3901', hostname: 'g', isUp: true, role: { zone: 'z', tags: ['primary'], capacity: 440000000000 }, dataPartition: { available: 400, total: 480 }, metadataPartition: { available: 7, total: 16 } }] };
    const health: RawHealth = { status: 'healthy', knownNodes: 1, connectedNodes: 1, storageNodes: 1, storageNodesUp: 1, partitions: 256, partitionsQuorum: 256, partitionsAllOk: 256 };
    const stats: RawStats = { bucketCount: 2, totalObjectCount: 39859, totalObjectBytes: 9350000000, dataAvail: 400, metadataAvail: 7, freeform: '' };
    const c = normCluster(status, health, stats);
    expect(c.status).toBe('healthy');
    expect(c.nodes.length).toBe(1);
    expect(c.nodes[0]!.garageVersion).toBe('v2.3.0');
    expect(c.objects).toBe(39859);
    expect(c.bytes).toBe(9350000000);
    expect(c.buckets).toBe(2);
    expect(c.partitions).toEqual({ total: 256, ok: 256 });
  });
});

describe('desiredPermCalls', () => {
  it('separa o estado desejado em allow (trues) e deny (falses)', () => {
    expect(desiredPermCalls({ read: true, write: false, owner: false }))
      .toEqual({ allow: { read: true, write: false, owner: false }, deny: { read: false, write: true, owner: true } });
  });
  it('tudo true → allow tudo, deny nada', () => {
    expect(desiredPermCalls({ read: true, write: true, owner: true }))
      .toEqual({ allow: { read: true, write: true, owner: true }, deny: { read: false, write: false, owner: false } });
  });
});

describe('keySecret', () => {
  const creds = { endpoint: 'http://garage:3903/', token: 'tok' };

  /** Troca o fetch global e devolve o que foi chamado. */
  function spyFetch(payload: unknown, status = 200) {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return Promise.resolve(new Response(JSON.stringify(payload), { status }));
    }) as typeof globalThis.fetch;
    return { calls, restore: () => { globalThis.fetch = original; } };
  }

  it('pede showSecretKey=true — sem isso o Garage omite o secret', async () => {
    const spy = spyFetch({ accessKeyId: 'GK1', name: 'app', secretAccessKey: 's3cr3t' });
    try {
      const r = await garageAdmin(creds).keySecret('GK1');
      expect(spy.calls).toHaveLength(1);
      expect(spy.calls[0]!.url).toBe('http://garage:3903/v2/GetKeyInfo?id=GK1&showSecretKey=true');
      expect(r.secretAccessKey).toBe('s3cr3t');
    } finally { spy.restore(); }
  });

  it('escapa o id na URL', async () => {
    const spy = spyFetch({ accessKeyId: 'a b&c', name: '', secretAccessKey: 'x' });
    try {
      await garageAdmin(creds).keySecret('a b&c');
      expect(spy.calls[0]!.url).toContain('id=a%20b%26c');
    } finally { spy.restore(); }
  });

  it('manda o bearer do token de admin', async () => {
    const spy = spyFetch({ accessKeyId: 'GK1', name: '', secretAccessKey: 'x' });
    try {
      await garageAdmin(creds).keySecret('GK1');
      const headers = spy.calls[0]!.init!.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer tok');
    } finally { spy.restore(); }
  });

  it('erro do Garage vira AdminError com o status', async () => {
    const spy = spyFetch({ error: 'no' }, 403);
    try {
      await expect(garageAdmin(creds).keySecret('GK1')).rejects.toThrow('admin_403');
    } finally { spy.restore(); }
  });
});
