/* ============================================================
   Cockpit S3 — API contract (types)
   These interfaces define exactly what the frontend expects from
   the backend API. No data is mocked: the UI calls the endpoints
   in core/api.ts and renders whatever the server returns (or shows
   loading / empty / error states). Build the backend to match.
   ============================================================ */

export type Perm = 'owner' | 'read-write' | 'read-only';
export type Role = 'admin' | 'user';

export type FileType =
  | 'image' | 'video' | 'audio' | 'pdf'
  | 'sheet' | 'code' | 'text' | 'archive' | 'file';

/** GET /api/me */
export interface Me {
  username: string;
  /** when 'admin', the Usuários (admin) view is shown. */
  role?: Role;
}

/** GET /api/users — app login accounts and their per-bucket access. */
export interface User {
  username: string;
  role: Role;
  created?: string;
  lastLogin?: string;
  active?: boolean;
  grants: Record<string, Perm | null>;
}

export interface ClusterNode {
  id: string;
  region: string;
  status: 'online' | 'offline' | 'degraded';
  load: number; // 0..1
}

/** GET /api/cluster */
export interface Cluster {
  nodes: ClusterNode[];
  version: string;
  replication: string;
  usedBytes: number;
  quotaBytes: number;
  objects: number;
}

/** GET /api/buckets */
export interface Bucket {
  /** composite id: `<connectionId>:<bucketName>` — opaque routing key. */
  id: string;
  /** display name (the bucket name within its connection). */
  name?: string;
  /** connection display name. */
  connection?: string;
  region: string;
  region2?: string;
  perm: Perm;
  /** stats are optional — unknown unless the Garage admin API is wired (shown as "—"). */
  used?: number;
  quota?: number;
  objects?: number;
  updated?: string;
  color?: 'cyan' | 'green' | 'amber';
}

/** Item returned by GET /api/buckets/:id/objects */
export interface ObjectItem {
  kind: 'file' | 'folder';
  name: string;
  key: string;
  type?: FileType;
  size?: number;
  modified?: string;
  by?: string;
}

export interface ObjectListing {
  bucket: string;
  path: string;
  items: ObjectItem[];
  /** present when there are more pages; pass back as `token` to continue. */
  nextToken?: string;
}

export interface PresignedUrl {
  url: string;
  disposition?: 'inline' | 'attachment';
}

export interface AccessKey {
  id: string;
  name: string;
  created: string;
  lastUsed?: string;
  grants: Record<string, Perm | null>;
}

/** A Garage/S3 connection (admin). Secret never leaves the server (`secretSet` only). */
export interface Connection {
  id: string;
  name: string;
  endpoint: string;
  region: string;
  accessKey: string;
  buckets: string[];
  secretSet: boolean;
  createdAt: string;
}

export type ActivityAction =
  | 'upload' | 'download' | 'delete' | 'grant' | 'revoke' | 'key' | 'bucket';

export interface ActivityEvent {
  action: ActivityAction;
  actor: string;
  bucket: string;
  target: string;
  at: string;
}
