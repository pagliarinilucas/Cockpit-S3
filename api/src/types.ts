export type Perm = 'owner' | 'read-write' | 'read-only';
export type Role = 'admin' | 'user';

export interface UserRow {
  username: string;
  password_hash: string;
  role: Role;
  token_version: number;
  grants: string;            // JSON string
  active: number;
  created_at: string;
  last_login: string | null;
}

/** Shape returned to the client (never includes password_hash). */
export interface PublicUser {
  username: string;
  role: Role;
  created?: string;
  lastLogin?: string;
  active?: boolean;
  grants: Record<string, Perm | null>;
}

/** Access-token payload (the part we control). */
export interface AccessClaims {
  sub: string;
  role: Role;
  ver: number;
}
