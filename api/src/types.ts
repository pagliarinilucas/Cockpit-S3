export type Perm = 'owner' | 'read-write' | 'read-only' | 'view-only';
export type Role = 'admin' | 'user';

export interface UserGrant { bucketId: string; prefix: string; perm: Perm }
export interface UserBlock { bucketId: string; prefix: string }

/** Shape returned to the client (never includes password_hash). */
export interface PublicUser {
  username: string;
  role: Role;
  created?: string;
  lastLogin?: string;
  active?: boolean;
  groups: string[];          // group ids the user belongs to
  grants: UserGrant[];       // direct allow grants
  blocks: UserBlock[];       // direct deny blocks
}

/** Access-token payload (the part we control). */
export interface AccessClaims {
  sub: string;
  role: Role;
  ver: number;
}

export interface ClusterInput { name: string; adminEndpoint: string; adminToken: string; s3Endpoint: string; region?: string }
export interface ClusterFull extends ClusterInput { id: string; region: string; internalKeyId: string | null; internalSecret: string | null; createdAt: string }
export interface ClusterPublic { id: string; name: string; adminEndpoint: string; s3Endpoint: string; region: string; adminConfigured: boolean; createdAt: string }
