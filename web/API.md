# Cockpit S3 — API contract

The frontend talks to a backend at **`http://localhost:3000`** in development (the Vite
dev server proxies `/api/*` there — see `vite.config.ts`). In production, serve the SPA
and API from the same origin so the relative `/api` path keeps working.

Nothing in the UI is mocked. Each view calls these endpoints (see `src/core/api.ts`)
and renders the response, or shows a loading / empty / error state when the call is
pending, empty, or fails. Build the backend to match the shapes below (TypeScript types
live in `src/core/models.ts`).

**Auth (access + refresh + versioning)** — implemented in the `cockpit-s3-api` project
(Elysia/Bun). The flow:
- `POST /api/login` returns a short-lived **access token** in the JSON body and sets a
  rotating **refresh token** in an httpOnly cookie (`SameSite=Strict`, `Path=/api/auth`).
- The client keeps the access token **in memory** and sends it as
  `Authorization: Bearer <token>` on every call.
- On `401`, the client calls `POST /api/auth/refresh` once (cookie-based, rotates the
  refresh token) and retries. If refresh fails, it returns to login.
- The access token carries a `ver` claim equal to the user's `token_version`; bumping
  it (logout-all / password change) invalidates every outstanding access token.

## Endpoints

### Auth
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/login` | `{ username, password }` | `{ accessToken, expiresIn, user }` + sets refresh cookie |
| POST | `/api/auth/refresh` | — (refresh cookie) | `{ accessToken, expiresIn, user }` + rotates cookie |
| POST | `/api/logout` | — | `{ ok }` + clears refresh cookie (this device) |
| POST | `/api/auth/logout-all` | — | `{ ok }` — bumps token version, kills all sessions |
| POST | `/api/auth/password` | `{ current, next }` | `{ ok }` — change own password (bumps version) |
| GET  | `/api/me` | — | `Me` → `{ username, role? }` |

Reuse of an already-rotated refresh token is treated as theft: the whole rotation
family is revoked. Passwords are hashed with argon2id; login is rate-limited.

### Cluster & buckets
| Method | Path | Returns |
|---|---|---|
| GET  | `/api/buckets` | `Bucket[]` → `{ id, name, connection, region, perm }` (aggregated across connections) |
| POST | `/api/buckets` | body `{ connectionId, name }` → created `Bucket` (admin) |

`perm` is `"owner" | "read-write" | "read-only"`. `id` is the composite
`<connectionId>:<bucketName>`. Stats (`used/quota/objects`) are optional and omitted
unless the Garage admin API is configured on the connection (see **Garage Admin API** below).

### Objects (per bucket)
| Method | Path | Query / Body | Returns |
|---|---|---|---|
| GET    | `/api/buckets/:id/objects` | `?path=<prefix>` | `ObjectListing` → `{ bucket, path, items[] }` |
| POST   | `/api/buckets/:id/objects` | multipart `path`, `file` | upload (supports `UploadProgress` events) |
| DELETE | `/api/buckets/:id/objects` | body `{ keys: string[] }` | — |
| POST   | `/api/buckets/:id/folders` | body `{ path, name }` | — |
| GET    | `/api/buckets/:id/download` | `?key=<key>` | `{ url }` presigned **attachment** |
| GET    | `/api/buckets/:id/preview`  | `?key=<key>` | `{ url, disposition }` presigned **inline** when renderable |

`ObjectItem` → `{ kind: 'file'|'folder', name, key, type?, size?, modified?, by? }`.
`key` is the full S3 key (files) or the prefix ending in `/` (folders). `type` may be
omitted — the UI infers it from the extension. `path`/`prefix` is normalized to end
with `/` (or empty for root).

**Preview** must return a presigned URL the browser can render inline (set
`ResponseContentDisposition: inline`) for images, PDF, **video and audio** — the UI
opens those directly in `<img>` / `<video>` / `<audio>` / `<iframe>`. The user
explicitly wanted to view images, PDFs and videos without downloading. Other types
use **download** instead.

### Garage Admin API (per-connection, admin)
Habilitado quando a conexão tem `adminEndpoint` + `adminToken` (Garage Admin API v2). Tudo admin-only.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET    | `/api/connections/:id/cluster` | — | `ClusterSummary` (status, nodes, partitions, buckets, objects, bytes) |
| GET    | `/api/connections/:id/garage/buckets` | — | `GarageBucket[]` (aliases, objects, bytes, quotas, keys+perms) |
| POST   | `/api/connections/:id/garage/buckets` | `{ alias }` | bucket criado |
| DELETE | `/api/connections/:id/garage/buckets/:bucketId` | — | `{ ok }` (400 se não vazio) |
| PUT    | `/api/connections/:id/garage/buckets/:bucketId/quotas` | `{ maxSize\|null, maxObjects\|null }` | atualizado |
| GET    | `/api/connections/:id/keys` | — | `GarageKey[]` (permissão por bucket) |
| POST   | `/api/connections/:id/keys` | `{ name }` | `NewGarageKey` (inclui `secretAccessKey`, retornado uma vez) |
| DELETE | `/api/connections/:id/keys/:keyId` | — | `{ ok }` |
| PUT    | `/api/connections/:id/keys/:keyId/buckets/:bucketId` | `{ read, write, owner }` | `{ ok }` (Allow/Deny) |

Retorna `409 admin_not_configured` se a conexão não tem admin endpoint/token; `502` em erro da Admin API do Garage.

### Users (admin only)
Only shown when `GET /api/me` returns `role: "admin"`. The backend must still enforce
admin-only access on every route below.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET    | `/api/users` | — | `User[]` → `{ username, role, created?, lastLogin?, active?, groups, grants, blocks }` |
| POST   | `/api/users` | `{ username, password, role }` | created `User` (use `409` if username exists) |
| PATCH  | `/api/users/:username` | `{ role }` | updated `User` |
| PUT    | `/api/users/:username/grants` | `{ bucketId, prefix?, perm\|null }` | updated `User` (perm null removes) |
| PUT    | `/api/users/:username/blocks` | `{ bucketId, prefix?, blocked }` | updated `User` |
| PUT    | `/api/users/:username/groups` | `{ groupId, member }` | updated `User` |
| POST   | `/api/users/:username/password` | `{ password }` | — (reset password) |
| DELETE | `/api/users/:username` | — | — |

`role` is `"admin" | "user"`. A user's access is: `groups: string[]` (group ids), `grants:
{ bucketId, prefix, perm }[]` (direct allows), and `blocks: { bucketId, prefix }[]` (denies).
`prefix` is `""` for the whole bucket or a folder prefix ending in `/`. Passwords arrive in
plaintext over the session-protected channel; **hash them server-side** (argon2id) before storing.

### Grupos (admin only)
Reusable permission groups. A group holds `allow` grants by bucket (`prefix:""`) or folder.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET    | `/api/groups` | — | `Group[]` → `{ id, name, created?, members, grants }` |
| POST   | `/api/groups` | `{ name }` | created `Group` (409 if name exists) |
| PATCH  | `/api/groups/:id` | `{ name }` | updated `Group` |
| DELETE | `/api/groups/:id` | — | `{ ok }` |
| PUT    | `/api/groups/:id/grants` | `{ bucketId, prefix?, perm\|null }` | updated `Group` (perm null removes) |

`grants` (group and user) is `{ bucketId, prefix, perm }[]`. **Effective permission per object
key:** a user `deny` (`/blocks`) is absolute; otherwise the highest `perm` among all applicable
allows (direct + groups) whose `prefix` covers the key wins; admins are `owner` of everything.
`GET /api/buckets/:id/objects` filters items by visibility and returns `perm` (effective at
`path`). `GET /api/buckets` shows buckets with any access; its `perm` is the max in the bucket.

### Connections — Garage/S3 connections (admin only)
Multiple S3 connections are supported. Each has its own endpoint/credentials. The
**secret key is never returned** (`secretSet: boolean` only); an omitted `secretKey` on
update keeps the stored one.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET    | `/api/connections` | — | `Connection[]` → `{ id, name, endpoint, region, accessKey, buckets, secretSet, createdAt }` |
| POST   | `/api/connections` | `{ name, endpoint, region, accessKey, secretKey, buckets }` | created `Connection` |
| PUT    | `/api/connections/:id` | same (secretKey optional) | updated `Connection` |
| DELETE | `/api/connections/:id` | — | `{ ok }` |
| POST   | `/api/connections/test` | `{ id?, name?, endpoint, region?, accessKey, secretKey?, buckets? }` | `{ ok, buckets?, error? }` |

**Bucket ids are composite: `<connectionId>:<bucketName>`.** `GET /api/buckets` aggregates
across all connections and returns `{ id, name, connection, region, perm }`. All
`/api/buckets/:id/...` routes and `grants` keys use this composite id. Saved connections
persist server-side; `S3_*` env vars only seed the very first connection on first boot.

### Activity
| Method | Path | Returns |
|---|---|---|
| GET | `/api/activity` | `ActivityEvent[]` → `{ action, actor, bucket, target, at }` |

`action` is `"upload"|"download"|"delete"|"grant"|"revoke"|"key"|"bucket"`.

## Notes for implementers
- Authorization must be enforced **server-side** on every route — never trust the
  client's `key`/`path`.
- Presigned URLs should be short-lived (≈5 min) and carry the disposition decided by
  the server.
- If a bucket is `read-only` for the user, the UI hides write actions, but the backend
  must still reject writes defensively.
