# Migrating from the MinIO Console

## Why

- In **May 2025** the MinIO Community Edition console was reduced to an object browser. User, group, policy and most configuration management were removed from the community UI and are only available through the `mc admin` CLI (or MinIO's commercial products).
- In **February 2026** the MinIO community repository was archived, so the Community Edition no longer receives updates from upstream.

If your team used the MinIO Console to let people browse buckets and share files, you have two separate decisions:

1. **Replace the console** — put Cockpit S3 in front of your existing MinIO. No data moves. This takes minutes.
2. **Optionally replace MinIO itself** — move the data to another S3 server (for example Garage) or a hosted provider. Cockpit S3 works the same on top of either.

## Concept mapping

| MinIO Console | Cockpit S3 | Notes |
| --- | --- | --- |
| Users (IAM users) | Users | Cockpit users are console accounts; they never get S3 keys. |
| Groups | Groups | Grants given to a group apply to all its members. |
| Policies (JSON, per bucket/prefix) | Permission matrix: `view-only` / `read` / `write` / `owner` per bucket, with per-folder overrides, plus per-user blocks | Covers the common "who can see/download/upload in which bucket or folder" cases. Arbitrary IAM conditions (IP ranges, tags, time) are not modeled. |
| Access keys / service accounts | One access key per **connection** | Cockpit uses a single least-privilege key per connection to talk to MinIO; per-user rules are enforced by Cockpit. |
| Object browser | Files view | Upload, folders, search, multi-select, ZIP download, previews, spreadsheet editor. |
| Share (presigned URL, up to 7 days) | Expiring public links | 1 hour to 30 days, optional first-IP lock, revocation, served by Cockpit so MinIO stays private. |
| — | `view-only` level | Preview without download. |
| Audit / logging targets | Audit log in the UI; export and webhook/syslog forwarding in Pro | Covers user actions done through Cockpit, not direct S3 API traffic from other clients. |
| Identity (OpenID / LDAP) | OIDC SSO in Pro; LDAP on the roadmap | See [`sso-oidc.md`](./sso-oidc.md). |
| Server-side encryption (KES) | Optional console-side encryption at rest per bucket | Different model: Cockpit encrypts before upload. Objects encrypted by Cockpit can only be read through Cockpit. |

### Not covered

Cockpit S3 is not a MinIO administration tool. Keep using `mc` (or your provider's tools) for:

- bucket replication and site replication;
- lifecycle / ILM rules, tiering, object locking, retention and legal hold;
- versioning configuration;
- bucket notifications and events;
- quotas;
- server configuration, healing, decommissioning and monitoring of MinIO itself.

## Steps: Cockpit S3 in front of MinIO

1. **Inventory.** List users, groups and policies so you can recreate the access rules:

   ```bash
   mc admin user list myminio
   mc admin group list myminio
   mc admin policy list myminio
   mc admin policy info myminio <policy>
   ```

2. **Create a key for Cockpit** with access to the buckets it should manage. See [`quickstart/minio.md`](./quickstart/minio.md) for a least-privilege policy. One key per bucket (one connection each) gives the tightest isolation; one key for a set of buckets is simpler.

3. **Deploy Cockpit S3** ([quickstart](../README.md#-quickstart), [`deploy/`](../deploy/README.md)). Put it on the same network as MinIO; the MinIO API port does not need to be public.

4. **Add the connection:** **Settings → New connection**, endpoint `http://minio:9000`, region `us-east-1` (or your `MINIO_REGION`), the key from step 2.

5. **Recreate people and access:**
   - create groups matching your MinIO groups (e.g. `finance`, `partners`);
   - create users, or enable OIDC SSO (Pro) with auto-provisioning;
   - in the permission matrix, map each policy to a level per bucket, and add folder overrides where a policy was limited to a prefix.

   Typical mapping: `readonly` → `read`; `readwrite` → `write`; a bucket administrator → `owner`; consultants who may only look → `view-only`.

6. **Replace shared links.** Presigned URLs created in the MinIO Console expire on their own (at most 7 days). Create new links in Cockpit where needed.

7. **Lock down.** Once people use Cockpit, disable the MinIO users they no longer need (`mc admin user disable`) and stop exposing the MinIO console port.

## Optional: move from MinIO to Garage

If you want to leave MinIO entirely, you can copy the data to [Garage](./quickstart/garage.md) with [rclone](https://rclone.org/).

1. **Set up Garage** and create the target buckets and a key with read/write access to them ([`quickstart/garage.md`](./quickstart/garage.md)).

2. **Configure both remotes** in `~/.config/rclone/rclone.conf`:

   ```ini
   [minio]
   type = s3
   provider = Minio
   endpoint = http://minio:9000
   access_key_id = MINIO_KEY
   secret_access_key = MINIO_SECRET
   region = us-east-1

   [garage]
   type = s3
   provider = Other
   endpoint = http://garage:3900
   access_key_id = GARAGE_KEY
   secret_access_key = GARAGE_SECRET
   region = garage
   force_path_style = true
   ```

3. **Copy while MinIO is still in use**, then repeat to catch up:

   ```bash
   rclone sync minio:shared-files garage:shared-files --progress --checksum --transfers 16
   rclone check minio:shared-files garage:shared-files
   ```

   `rclone sync` makes the destination identical to the source, **including deleting files in the destination that are not in the source**. Double-check the direction. Use `rclone copy` if you prefer never to delete.

4. **Cut over.** Stop writes to MinIO (or put Cockpit users on `read` temporarily), run a final `rclone sync`, then in Cockpit add a Garage connection (or cluster) and move the permission grants to the new buckets.

5. **Keep MinIO read-only** for a while before decommissioning it.

Notes:

- `--checksum` compares hashes where both sides support it; multipart uploads may make ETag comparisons unreliable, in which case rclone falls back to size and modification time.
- Object versions, lifecycle rules, object locks and bucket policies are **not** copied by `rclone sync`; only current object data and basic metadata.
- Buckets encrypted by MinIO SSE are decrypted by MinIO on read, so rclone copies plaintext to the destination.
- Buckets encrypted by Cockpit S3 contain only ciphertext with random names. The Cockpit database ties those objects (wrapped keys and original names) to the original connection and bucket, so a raw rclone copy to a new connection is not readable through Cockpit. Move encrypted buckets through the Cockpit UI (download and re-upload into an encrypted bucket on the new connection) or ask for help.

Enterprise customers can get help with the migration: cockpits3@pm.me.
