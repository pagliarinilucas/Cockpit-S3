# cockpit-s3-api

Backend for **Cockpit S3** — **Elysia on Bun**, with a robust auth core. Talks to
Garage (S3) via the AWS SDK, and stores users / sessions / audit log in SQLite
(`bun:sqlite`). Implements the contract in `../cockpit-s3/API.md`.

## Auth design (the critical part)

- **Access token** — short-lived JWT (HS256 via `jose`, default 15 min), sent as
  `Authorization: Bearer`. Carries a `ver` claim = the user's `token_version`.
- **Versioning** — every protected request re-checks `ver` against the DB. Bumping
  `token_version` (logout-all, password change, admin reset) instantly invalidates
  **all** outstanding access tokens for that user.
- **Refresh token** — opaque, high-entropy, **rotating**, stored only as a SHA-256
  hash. Lives in an httpOnly + `SameSite=Strict` cookie scoped to `/api/auth`
  (CSRF-safe). Each refresh rotates the token.
- **Reuse detection** — presenting an already-rotated refresh token (token theft)
  revokes the entire rotation **family**.
- **Passwords** — argon2id via `Bun.password`. **Login** is rate-limited per user+IP.

## Run

```bash
bun install
cp .env.example .env      # set ACCESS_TOKEN_SECRET (32+ chars). S3_* are optional.
bun run dev               # http://localhost:3000  (watch mode)
# bun run start           # no watch
```

**Multiple Garage/S3 connections** are managed from the **UI** (Conexões, admin) and
stored in the DB — no need to put `S3_*` in `.env`. Env values, if present, only seed
the **first** connection on first boot. Buckets are addressed as `<connectionId>:<bucketName>`.

On first boot, an admin is created from `ADMIN_USERNAME` / `ADMIN_PASSWORD` (a random
password is generated and printed if you leave it blank).

Create/reset a user from the CLI:

```bash
bun run seed <username> <password> [admin|user]
```

## Layout

```
src/config.ts         env + secret validation
src/db.ts             Drizzle (bun-sqlite) + schema garantido no boot via CREATE TABLE
                      IF NOT EXISTS (users, sessions, activity, connections, settings,
                      groups, user_groups, grants, user_blocks) + backfill de grants legados
src/db/schema.ts      schema Drizzle tipado (fonte da verdade p/ queries e drizzle-kit)
src/auth/             passwords, tokens (access JWT + refresh), sessions (rotation +
                      reuse detection), rate-limit, service, guard, routes
src/users/            user store + admin CRUD routes (+ grants por prefixo, blocks, membership)
src/groups/           grupos de permissão (CRUD + grants) + /api/groups (admin)
src/auth/permissions  resolução de permissão por chave (deny absoluto, união de allows)
src/storage/          Garage S3 client + bucket/object routes (list/upload/download/
                      preview/delete/folders) com autorização por PASTA (prefixo)
src/audit/            SQLite activity log + /api/activity
src/connections/      multiple Garage/S3 connections in DB + /api/connections (admin)
src/settings/         legacy single-config store (kept only to migrate into a connection)
src/misc/             /api/cluster + /api/keys → 501 (need Garage ADMIN API; see below)
src/index.ts          Elysia app: CORS, error handler, mounts, listen
```

## Not yet wired

`/api/cluster` and Garage's native `/api/keys` require Garage's **admin API** (separate
from the S3 API + an admin token), so they return `501 not_implemented` for now rather
than fabricating data. Everything else (auth, users + permissions, S3 objects, audit)
is real.

## Notes

- Authorization is enforced **server-side** on every route, resolved **per object key**:
  a user-level `deny` (block) is absolute; otherwise the highest `perm` among all applicable
  allows (direct grants + the user's groups) whose `prefix` covers the key wins. Grants can be
  whole-bucket (`prefix:""`) or per-folder. Admins implicitly own all buckets.
- Presigned URLs expire in 5 min; preview returns `inline` for images/PDF/video/audio,
  `attachment` otherwise.
- Set `COOKIE_SECURE=true` and a strong `ACCESS_TOKEN_SECRET` in production (HTTPS).
- Persistência via **Drizzle ORM** sobre `bun:sqlite` (queries tipadas). Schema em
  `src/db/schema.ts`; o boot garante as tabelas com `CREATE TABLE IF NOT EXISTS` (seguro
  para DB novo, legado ou já migrado). Mudanças futuras de schema: `bun run db:generate`
  gera o SQL em `drizzle/` (aplicar com `bun run db:migrate`).
