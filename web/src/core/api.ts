import type {
  Me, Cluster, Bucket, BucketStats, ObjectListing, PresignedUrl,
  AccessKey, ActivityEvent, Perm, User, Role, Connection,
} from './models';

export interface ConnectionPayload {
  name: string; endpoint: string; region: string; accessKey: string; secretKey?: string; buckets: string[];
}

/**
 * API client. Base path `/api`, proxied to http://localhost:3000 in dev
 * (vite.config.ts). Nothing is mocked.
 *
 * Auth model (see cockpit-s3-api):
 *  - short-lived ACCESS token kept in memory, sent as `Authorization: Bearer`.
 *  - rotating REFRESH token in an httpOnly cookie (scoped to /api/auth).
 *  - on 401 we transparently hit /api/auth/refresh once and retry.
 */
const BASE = '/api';

export class ApiError extends Error {
  constructor(public status: number, message?: string) { super(message); }
}

let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(cb: () => void) { onUnauthorized = cb; }

// de-duplicate concurrent refreshes
let refreshing: Promise<boolean> | null = null;
function doRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
        if (!res.ok) return false;
        accessToken = (await res.json()).accessToken ?? null;
        return !!accessToken;
      } catch { return false; }
    })();
    refreshing.finally(() => { refreshing = null; });
  }
  return refreshing;
}

async function req<T>(
  method: string, path: string,
  opts: { params?: Record<string, string>; body?: unknown } = {},
  retry = false,
): Promise<T> {
  let url = BASE + path;
  if (opts.params) {
    const qs = new URLSearchParams(opts.params).toString();
    if (qs) url += '?' + qs;
  }
  const headers: Record<string, string> = {};
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  const init: RequestInit = { method, credentials: 'include', headers };
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }

  let res: Response;
  try { res = await fetch(url, init); }
  catch { throw new ApiError(0, 'network'); }

  // transparent refresh + retry once
  if (res.status === 401 && !retry && path !== '/login' && !path.startsWith('/auth/refresh')) {
    if (await doRefresh()) return req<T>(method, path, opts, true);
    accessToken = null;
    onUnauthorized?.();
  }

  if (!res.ok) throw new ApiError(res.status, res.statusText);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Authenticated fetch that returns a Blob (with the same 401→refresh→retry flow). */
async function fetchBlob(path: string, params: Record<string, string>, retry = false): Promise<Blob> {
  const url = BASE + path + '?' + new URLSearchParams(params).toString();
  const headers: Record<string, string> = {};
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  let res: Response;
  try { res = await fetch(url, { credentials: 'include', headers }); }
  catch { throw new ApiError(0, 'network'); }
  if (res.status === 401 && !retry) {
    if (await doRefresh()) return fetchBlob(path, params, true);
    accessToken = null; onUnauthorized?.();
  }
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  return res.blob();
}

interface AuthResponse { accessToken: string; expiresIn: number; user: Me }

export const api = {
  // auth
  async login(username: string, password: string) {
    const data = await req<AuthResponse>('POST', '/login', { body: { username, password } });
    accessToken = data.accessToken;
    return data;
  },
  async logout() {
    try { await req('POST', '/logout', { body: {} }); } finally { accessToken = null; }
  },
  /** Resume a session on page load using the refresh cookie. Returns the user or null. */
  async restore(): Promise<Me | null> {
    if (await doRefresh()) { try { return await req<Me>('GET', '/me'); } catch { return null; } }
    return null;
  },
  logoutAll: () => req<{ ok: boolean }>('POST', '/auth/logout-all', { body: {} }),
  changePassword: (current: string, next: string) => req('POST', '/auth/password', { body: { current, next } }),
  me: () => req<Me>('GET', '/me'),

  // cluster / buckets
  cluster: () => req<Cluster>('GET', '/cluster'),
  buckets: () => req<Bucket[]>('GET', '/buckets'),
  bucketStats: (bucketId: string) => req<BucketStats>('GET', `/buckets/${encodeURIComponent(bucketId)}/stats`),
  createBucket: (connectionId: string, name: string) => req<Bucket>('POST', '/buckets', { body: { connectionId, name } }),

  // objects
  list: (bucketId: string, path = '', token?: string) => req<ObjectListing>('GET', `/buckets/${encodeURIComponent(bucketId)}/objects`, { params: token ? { path, token } : { path } }),
  /** Recursive search under `path` across the whole bucket (server-side, all pages). */
  search: (bucketId: string, path: string, q: string) => req<ObjectListing>('GET', `/buckets/${encodeURIComponent(bucketId)}/search`, { params: { path, q } }),
  download: (bucketId: string, key: string) => req<PresignedUrl>('GET', `/buckets/${encodeURIComponent(bucketId)}/download`, { params: { key } }),
  preview: (bucketId: string, key: string) => req<PresignedUrl>('GET', `/buckets/${encodeURIComponent(bucketId)}/preview`, { params: { key } }),
  /** Object streamed through the API as a Blob (same origin, works over HTTPS). */
  objectBlob: (bucketId: string, key: string, mode: 'preview' | 'download' = 'preview') =>
    fetchBlob(`/buckets/${encodeURIComponent(bucketId)}/raw`, { key, mode }),
  /** Same, as a local blob URL. Caller must URL.revokeObjectURL() when done. */
  async objectUrl(bucketId: string, key: string, mode: 'preview' | 'download' = 'preview'): Promise<string> {
    return URL.createObjectURL(await fetchBlob(`/buckets/${encodeURIComponent(bucketId)}/raw`, { key, mode }));
  },
  createFolder: (bucketId: string, path: string, name: string) => req('POST', `/buckets/${encodeURIComponent(bucketId)}/folders`, { body: { path, name } }),
  deleteObjects: (bucketId: string, keys: string[]) => req('DELETE', `/buckets/${encodeURIComponent(bucketId)}/objects`, { body: { keys } }),

  /** Upload one file with progress via XHR (fetch can't report upload progress). */
  upload(bucketId: string, path: string, file: File, onProgress: (p: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('path', path);
      form.append('file', file, file.name);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/buckets/${encodeURIComponent(bucketId)}/objects`);
      xhr.withCredentials = true;
      if (accessToken) xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new ApiError(xhr.status));
      xhr.onerror = () => reject(new ApiError(0));
      xhr.send(form);
    });
  },

  // access keys
  keys: () => req<AccessKey[]>('GET', '/keys'),
  createKey: (name: string) => req<AccessKey>('POST', '/keys', { body: { name } }),
  setGrant: (keyId: string, bucketId: string, perm: Perm | null) => req<AccessKey>('PATCH', `/keys/${encodeURIComponent(keyId)}/grants`, { body: { bucketId, perm } }),

  // users (admin)
  users: () => req<User[]>('GET', '/users'),
  createUser: (username: string, password: string, role: Role) => req<User>('POST', '/users', { body: { username, password, role } }),
  setUserRole: (username: string, role: Role) => req<User>('PATCH', `/users/${encodeURIComponent(username)}`, { body: { role } }),
  setUserGrant: (username: string, bucketId: string, perm: Perm | null) => req<User>('PATCH', `/users/${encodeURIComponent(username)}/grants`, { body: { bucketId, perm } }),
  resetPassword: (username: string, password: string) => req('POST', `/users/${encodeURIComponent(username)}/password`, { body: { password } }),
  deleteUser: (username: string) => req('DELETE', `/users/${encodeURIComponent(username)}`),

  // activity
  activity: () => req<ActivityEvent[]>('GET', '/activity'),

  // connections — Garage/S3 connections (admin)
  connections: () => req<Connection[]>('GET', '/connections'),
  createConnection: (p: ConnectionPayload) => req<Connection>('POST', '/connections', { body: p }),
  updateConnection: (id: string, p: ConnectionPayload) => req<Connection>('PUT', `/connections/${encodeURIComponent(id)}`, { body: p }),
  deleteConnection: (id: string) => req('DELETE', `/connections/${encodeURIComponent(id)}`),
  testConnection: (p: ConnectionPayload & { id?: string }) => req<{ ok: boolean; buckets?: string[]; error?: string }>('POST', '/connections/test', { body: p }),
};

/** Shared helper for the views' error messages. */
export function apiErrMsg(e: unknown, verb = 'carregar'): string {
  const status = e instanceof ApiError ? e.status : -1;
  if (status === 0) return 'API indisponível em localhost:3000.';
  if (status === 501) return 'Recurso ainda não disponível no backend.';
  return `Erro ${status > 0 ? status : ''} ao ${verb}.`.replace('  ', ' ');
}
