// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
export interface AdminCreds { endpoint: string; token: string }
export interface Perm { read: boolean; write: boolean; owner: boolean }

export interface RawStatus {
  layoutVersion: number;
  nodes: { id: string; garageVersion: string; addr: string; hostname: string; isUp: boolean;
    role: { zone: string; tags: string[]; capacity: number | null } | null;
    dataPartition: { available: number; total: number } | null;
    metadataPartition: { available: number; total: number } | null; }[];
}
export interface RawHealth { status: string; knownNodes: number; connectedNodes: number; storageNodes: number; storageNodesUp: number; partitions: number; partitionsQuorum: number; partitionsAllOk: number }
export interface RawStats { bucketCount: number; totalObjectCount: number; totalObjectBytes: number; dataAvail: number; metadataAvail: number; freeform: string }

export interface ClusterSummary {
  status: string;
  knownNodes: number; connectedNodes: number; storageNodes: number; storageNodesUp: number;
  partitions: { total: number; ok: number };
  buckets: number; objects: number; bytes: number;
  dataAvail: number;
  nodes: { id: string; hostname: string; addr: string; zone: string; garageVersion: string; isUp: boolean; capacity: number | null; dataAvail: number | null; dataTotal: number | null }[];
}

/** Funde as 3 chamadas de cluster num resumo estável pro front. Pura. */
export function normCluster(status: RawStatus, health: RawHealth, stats: RawStats): ClusterSummary {
  return {
    status: health.status,
    knownNodes: health.knownNodes,
    connectedNodes: health.connectedNodes,
    storageNodes: health.storageNodes,
    storageNodesUp: health.storageNodesUp,
    partitions: { total: health.partitions, ok: health.partitionsAllOk },
    buckets: stats.bucketCount,
    objects: stats.totalObjectCount,
    bytes: stats.totalObjectBytes,
    dataAvail: stats.dataAvail,
    nodes: status.nodes.map((n) => ({
      id: n.id, hostname: n.hostname, addr: n.addr, zone: n.role?.zone ?? '—',
      garageVersion: n.garageVersion, isUp: n.isUp, capacity: n.role?.capacity ?? null,
      dataAvail: n.dataPartition?.available ?? null, dataTotal: n.dataPartition?.total ?? null,
    })),
  };
}

/** Estado desejado {read,write,owner} → o que mandar em AllowBucketKey (trues) e DenyBucketKey (falses). Pura. */
export function desiredPermCalls(want: Perm): { allow: Perm; deny: Perm } {
  return {
    allow: { read: want.read, write: want.write, owner: want.owner },
    deny: { read: !want.read, write: !want.write, owner: !want.owner },
  };
}

class AdminError extends Error {}

async function call<T>(creds: AdminCreds, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(creds.endpoint.replace(/\/$/, '') + path, {
      method,
      headers: { Authorization: `Bearer ${creds.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    throw new AdminError(`admin_unreachable: ${String((e as Error)?.message ?? e)}`);
  }
  const text = await res.text();
  if (!res.ok) throw new AdminError(`admin_${res.status}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : null) as T;
}

/** Cliente da Admin API v2 do Garage. */
export function garageAdmin(creds: AdminCreds) {
  return {
    async cluster(): Promise<ClusterSummary> {
      const [status, health, stats] = await Promise.all([
        call<RawStatus>(creds, 'GET', '/v2/GetClusterStatus'),
        call<RawHealth>(creds, 'GET', '/v2/GetClusterHealth'),
        call<RawStats>(creds, 'GET', '/v2/GetClusterStatistics'),
      ]);
      return normCluster(status, health, stats);
    },
    listBuckets: () => call<{ id: string; created: string; globalAliases: string[]; localAliases: string[] }[]>(creds, 'GET', '/v2/ListBuckets'),
    bucketInfo: (id: string) => call<{ id: string; created: string; globalAliases: string[]; websiteAccess: boolean; objects: number; bytes: number; quotas: { maxSize: number | null; maxObjects: number | null }; keys: { accessKeyId: string; name: string; permissions: Perm }[] }>(creds, 'GET', `/v2/GetBucketInfo?id=${encodeURIComponent(id)}`),
    /** Resolve um alias global (ou id hex) para o UUID hex do bucket (exigido por Allow/DenyBucketKey). */
    async resolveBucketId(aliasOrId: string): Promise<string> {
      if (/^[0-9a-f]{32}$/.test(aliasOrId)) return aliasOrId;
      const info = await call<{ id: string }>(creds, 'GET', `/v2/GetBucketInfo?globalAlias=${encodeURIComponent(aliasOrId)}`);
      return info.id;
    },
    createBucket: (globalAlias: string) => call(creds, 'POST', '/v2/CreateBucket', { globalAlias }),
    deleteBucket: (id: string) => call(creds, 'POST', `/v2/DeleteBucket?id=${encodeURIComponent(id)}`),
    setQuotas: (id: string, maxSize: number | null, maxObjects: number | null) => call(creds, 'POST', `/v2/UpdateBucket?id=${encodeURIComponent(id)}`, { quotas: { maxSize, maxObjects } }),
    addAlias: (bucketId: string, globalAlias: string) => call(creds, 'POST', '/v2/AddBucketAlias', { bucketId, globalAlias }),
    removeAlias: (bucketId: string, globalAlias: string) => call(creds, 'POST', '/v2/RemoveBucketAlias', { bucketId, globalAlias }),
    listKeys: () => call<{ id: string; name: string; created: string; expiration: string | null; expired: boolean }[]>(creds, 'GET', '/v2/ListKeys'),
    keyInfo: (id: string) => call<{ accessKeyId: string; name: string; created: string; expiration: string | null; expired: boolean; permissions: { createBucket: boolean }; buckets: { id: string; globalAliases: string[]; permissions: Perm }[] }>(creds, 'GET', `/v2/GetKeyInfo?id=${encodeURIComponent(id)}`),
    createKey: (name: string) => call<{ accessKeyId: string; name: string; secretAccessKey: string; created: string }>(creds, 'POST', '/v2/CreateKey', { name }),
    deleteKey: (id: string) => call(creds, 'POST', `/v2/DeleteKey?id=${encodeURIComponent(id)}`),
    async setBucketKeyPerm(bucketId: string, accessKeyId: string, want: Perm): Promise<void> {
      const { allow, deny } = desiredPermCalls(want);
      await call(creds, 'POST', '/v2/AllowBucketKey', { bucketId, accessKeyId, permissions: allow });
      await call(creds, 'POST', '/v2/DenyBucketKey', { bucketId, accessKeyId, permissions: deny });
    },
  };
}
