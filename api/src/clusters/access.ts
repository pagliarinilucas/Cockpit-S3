import { clustersStore } from './store';
import { garageAdmin } from '../garage/admin';
import { configureClusterS3 } from './routes';
import type { ClusterFull } from '../types';

const granted = new Set<string>(); // `${clusterId}:${bucket}` já liberado neste processo

/** (Re)cria a key interna do cluster, regrava o secret e reconfigura o client S3. */
async function recreateInternalKey(c: ClusterFull): Promise<ClusterFull> {
  const g = garageAdmin({ endpoint: c.adminEndpoint, token: c.adminToken });
  const key = await g.createKey(`cockpit-${c.name}`);
  clustersStore.setInternalKey(c.id, key.accessKeyId, key.secretAccessKey);
  const fresh = clustersStore.getFull(c.id)!;
  configureClusterS3(fresh);
  return fresh;
}

/** Garante que a key interna do cluster tem owner no bucket (idempotente, cacheado).
 *  Resolve o alias→UUID hex (exigido pelo AllowBucketKey) e recria a key se ela sumiu no Garage. */
export async function ensureClusterBucketAccess(clusterId: string, bucket: string): Promise<void> {
  const cacheKey = `${clusterId}:${bucket}`;
  if (granted.has(cacheKey)) return;
  let c = clustersStore.getFull(clusterId);
  if (!c) throw new Error('cluster_not_found');
  if (!c.internalKeyId) c = await recreateInternalKey(c);
  const g = garageAdmin({ endpoint: c.adminEndpoint, token: c.adminToken });
  const hexId = await g.resolveBucketId(bucket);
  try {
    await g.setBucketKeyPerm(hexId, c.internalKeyId!, { read: true, write: true, owner: true });
  } catch (e) {
    // a key interna pode ter sido apagada/rotacionada no Garage → verifica, recria e tenta uma vez
    const keyId = c.internalKeyId;
    const stillExists = await g.listKeys().then((ks) => ks.some((k) => k.id === keyId)).catch(() => true);
    if (stillExists) throw e;
    c = await recreateInternalKey(c);
    await g.setBucketKeyPerm(hexId, c.internalKeyId!, { read: true, write: true, owner: true });
  }
  granted.add(cacheKey);
}

/** True se o sourceId é um cluster. */
export function isCluster(sourceId: string): boolean { return clustersStore.exists(sourceId); }
