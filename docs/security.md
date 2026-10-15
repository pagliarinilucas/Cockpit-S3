# Security model

This page describes where Cockpit S3 keeps secrets, how users are authenticated and authorized, and how to deploy it safely. To report a vulnerability, see [`SECURITY.md`](../SECURITY.md).

## What is stored where

Everything the console knows lives in **one SQLite file** in the data volume (`DB_PATH`, `/data/cockpit.sqlite` in the container):

| Data | How it is stored |
| --- | --- |
| User passwords | argon2id hashes (`Bun.password`) |
| Refresh tokens | SHA-256 hashes only |
| S3 connection secret keys, Garage admin tokens | Plaintext in the database; never returned by the API |
| DR backup destination credentials and recovery secret | Plaintext in the database; never returned by the API (the recovery code is shown once) |
| Wrapped data keys of encrypted objects | Encrypted with the KEK |
| License key | The signed key as provided (it contains no secret) |
| Audit log, permissions, groups, share links | Plain rows |

The SQLite file is **not encrypted** at rest. The server must read S3 credentials to talk to your storage, so anyone who can read the data volume can read them. Protect the volume:

- restrict filesystem access to the host and the volume;
- encrypt the disk (LUKS, cloud provider volume encryption);
- treat database backups as secret material.

The key-encryption key (KEK) used for encryption at rest is **not** stored in the database. It is supplied through `COCKPIT_KEK_FILE` (preferred, e.g. a Docker secret) or `COCKPIT_KEK`.

## Encryption at rest

Optional, per bucket, enabled while the bucket is empty.

- Each object gets its own random data key (DEK). Content is encrypted with libsodium's XChaCha20-Poly1305 secretstream in 1 MiB chunks, before it is uploaded.
- The DEK is wrapped with the KEK (XChaCha20-Poly1305 AEAD) and stored in the database.
- In the bucket, objects have random names and contain only ciphertext. Someone with the bucket, a bucket backup or the storage disks cannot read file names or contents.
- Users with access in the console see and download files normally; decryption is streamed by the server.

What it does not protect against: a compromise of the running Cockpit S3 host (which holds the KEK in memory and the database). Losing the KEK **and** the database means losing access to encrypted objects; this is why the DR backup exists.

Full details, including memory behavior and test instructions: [`encryption.md`](./encryption.md).

## Disaster-recovery backup

The DR backup periodically uploads an encrypted bundle containing the KEK and the database to an S3 destination you choose (separate from your data buckets). The bundle is encrypted with a key derived from a **recovery code** (argon2id) that is shown once; optionally it can also be sealed to a vendor public key for assisted recovery. Restore is done from the command line on a recovery machine (`bun run restore`). See [`encryption.md`](./encryption.md#backup-de-recuperação-escrowdr).

Keep the recovery code offline and separate from the storage it protects.

## Authentication

- **Passwords:** argon2id. Login is rate-limited per user and IP (`LOGIN_MAX_ATTEMPTS`, default 8 per `LOGIN_WINDOW_MS`, default 5 minutes).
- **Access token:** HS256 JWT signed with `ACCESS_TOKEN_SECRET`, 15 minutes by default (`ACCESS_TOKEN_TTL`), sent as `Authorization: Bearer` and kept in memory by the browser. It carries a `ver` claim compared on every request with the user's `token_version`. Logging out everywhere, changing a password or an admin reset increments the version and invalidates every outstanding access token immediately.
- **Refresh token:** opaque and high-entropy, 30 days by default (`REFRESH_TOKEN_TTL`), stored only as a SHA-256 hash, in an `httpOnly`, `Secure`, `SameSite=Strict` cookie scoped to `/api/auth`. Each refresh rotates it. Presenting an already-rotated token is treated as theft and revokes the entire token family.
- **SSO (Pro):** OpenID Connect authorization code flow with PKCE, `state` and `nonce`; the ID token is verified against the provider's JWKS. See [`sso-oidc.md`](./sso-oidc.md).

In production the API refuses to start without an `ACCESS_TOKEN_SECRET` of at least 32 characters.

## Authorization

- Every route checks permissions on the server. Hiding a button in the UI is never the only control.
- Permissions are resolved **per object key**: a user-level block is absolute; otherwise the highest level among all grants (direct and through groups) whose prefix covers the key applies. Grants can be for a whole bucket or a folder prefix.
- Levels: `view-only` (preview, no download — the API refuses to return file bytes as an attachment), `read`, `write`, `owner`. Admins own all buckets.
- Public share links are created only by users with the share permission, only for files they can download, with an expiry between 1 hour and 30 days, an optional first-IP lock, and revocation. The token is 32 random bytes.

## Network exposure

- Downloads, previews, ZIP archives and share links are **streamed through the API**. The S3 endpoint only needs to be reachable from the Cockpit container and can stay on a private network. The "copy signed link" action is the exception: it returns a 5-minute presigned URL to the S3 endpoint.
- The Garage Admin API (port 3903) should never be exposed publicly.
- License verification is offline. Cockpit S3 makes no outbound calls except to the S3 endpoints, Garage admin endpoints, OIDC provider, DR backup destination and audit forwarding targets you configure.

## Deployment recommendations

1. **TLS everywhere.** Put Cockpit S3 behind a reverse proxy with HTTPS (Traefik, Caddy, nginx, or your platform's proxy) and keep `COOKIE_SECURE=true`. Use HTTPS for S3 endpoints that cross an untrusted network.
2. **One least-privilege key per connection.** Give each connection an access key limited to the bucket(s) it manages, with only the operations listed in [`quickstart/README.md`](./quickstart/README.md#what-the-key-needs). Never use root or master credentials. Per-provider instructions: [`quickstart/`](./quickstart/).
3. **Strong secrets.** Generate `ACCESS_TOKEN_SECRET` with `openssl rand -hex 32`. Set a strong `ADMIN_PASSWORD` or change the generated one after the first login.
4. **KEK as a file.** Prefer `COCKPIT_KEK_FILE` pointing to a Docker/Kubernetes secret over an environment variable.
5. **Backups.** Snapshot the `/data` volume regularly. If you use encryption at rest, enable the DR backup and test a restore.
6. **Keep up to date.** Watch the repository releases for security fixes.
7. **Audit.** Review the audit log; with Pro, forward it to your SIEM (webhook or syslog) and set a retention period.
