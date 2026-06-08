export type Perm = 'owner' | 'read-write' | 'read-only';
export type Role = 'admin' | 'user';

export interface UserRow {
  username: string;
  password_hash: string;
  role: Role;
  token_version: number;
  grants: string;            // legacy JSON column (unused after migration)
  active: number;
  created_at: string;
  last_login: string | null;
}

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
