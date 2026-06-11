import { describe, it, expect } from 'bun:test';
import { normCluster, desiredPermCalls, type RawStatus, type RawHealth, type RawStats } from './admin';

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
