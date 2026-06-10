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

export interface UserGrant { bucketId: string; prefix: string; perm: Perm }
export interface UserBlock { bucketId: string; prefix: string }

/** GET /api/users — app login accounts and their access. */
export interface User {
  username: string;
  role: Role;
  created?: string;
  lastLogin?: string;
  active?: boolean;
  groups: string[];        // group ids the user belongs to
  grants: UserGrant[];     // direct allow grants
  blocks: UserBlock[];     // direct deny blocks
}

export interface GroupGrant { bucketId: string; prefix: string; perm: Perm }
/** GET /api/groups — reusable permission groups. */
export interface Group {
  id: string;
  name: string;
  created?: string;
  members?: number;
  grants: GroupGrant[];
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
  /** stats still being computed (filled in async after the grid loads). */
  statsLoading?: boolean;
  /** stats hit the scan cap, so used/objects are a lower bound (show "+"). */
  statsTruncated?: boolean;
}

export interface BucketStats { used: number; objects: number; truncated: boolean }

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
  /** effective permission at `path` (drives write UI for this folder). */
  perm?: Perm | null;
  /** present when there are more pages; pass back as `token` to continue. */
  nextToken?: string;
}

export interface PresignedUrl {
  url: string;
  disposition?: 'inline' | 'attachment';
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
  adminEndpoint?: string;
  adminConfigured?: boolean;
  createdAt: string;
}

/** GET /api/connections/:id/cluster — Garage Admin API cluster summary. */
export interface ClusterSummary {
  status: string;
  knownNodes: number;
  connectedNodes: number;
  storageNodes: number;
  storageNodesUp: number;
  partitions: { total: number; ok: number };
  buckets: number;
  objects: number;
  bytes: number;
  dataAvail: number;
  nodes: {
    id: string; hostname: string; addr: string; zone: string; garageVersion: string;
    isUp: boolean; capacity: number | null; dataAvail: number | null; dataTotal: number | null;
  }[];
}

export interface GaragePerm { read: boolean; write: boolean; owner: boolean }

/** GET /api/connections/:id/garage/buckets — native Garage buckets. */
export interface GarageBucket {
  id: string;
  aliases: string[];
  objects: number;
  bytes: number;
  quotas: { maxSize: number | null; maxObjects: number | null };
  keys: { accessKeyId: string; name: string; permissions: GaragePerm }[];
}

/** GET /api/connections/:id/keys — native Garage access keys. */
export interface GarageKey {
  id: string;
  name: string;
  created: string;
  expired: boolean;
  buckets: { id: string; aliases: string[]; permissions: GaragePerm }[];
}

/** POST /api/connections/:id/keys — secret returned once. */
export interface NewGarageKey { accessKeyId: string; name: string; secretAccessKey: string; created: string }

export type ActivityAction =
  | 'upload' | 'download' | 'delete' | 'grant' | 'revoke' | 'key' | 'bucket';

export interface ActivityEvent {
  action: ActivityAction;
  actor: string;
  bucket: string;
  target: string;
  at: string;
}
