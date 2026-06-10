import { clustersStore } from './store';
import { garageAdmin } from '../garage/admin';
import { configureClusterS3 } from './routes';

const granted = new Set<string>(); // `${clusterId}:${bucket}` já liberado neste processo

/** Garante que a key interna do cluster tem owner no bucket (idempotente, cacheado).
 *  Se a key interna sumiu no Garage, recria + regrava + reconfigura o client S3. */
export async function ensureClusterBucketAccess(clusterId: string, bucket: string): Promise<void> {
  const cacheKey = `${clusterId}:${bucket}`;
  if (granted.has(cacheKey)) return;
  let c = clustersStore.getFull(clusterId);
  if (!c) throw new Error('cluster_not_found');
  const g = garageAdmin({ endpoint: c.adminEndpoint, token: c.adminToken });
  if (!c.internalKeyId) {
    const key = await g.createKey(`cockpit-${c.name}`);
    clustersStore.setInternalKey(c.id, key.accessKeyId, key.secretAccessKey);
    c = clustersStore.getFull(clusterId)!;
    configureClusterS3(c);
  }
  await g.setBucketKeyPerm(bucket, c.internalKeyId!, { read: true, write: true, owner: true });
  granted.add(cacheKey);
}

/** True se o sourceId é um cluster. */
export function isCluster(sourceId: string): boolean { return clustersStore.exists(sourceId); }
