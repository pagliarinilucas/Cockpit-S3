# Garage

[Garage](https://garagehq.deuxfleurs.fr/) is a lightweight, geo-distributed S3 server. Cockpit S3 can connect to it in two ways:

- **Bucket connection** — a regular S3 access key, like any other provider. Works with Garage v1 and v2.
- **Cluster** — the Garage Admin API endpoint plus an admin token. Adds the cluster dashboard (health, nodes, partitions, bucket usage, keys) and lets Cockpit manage buckets and keys. Uses the **Admin API v2**, so it needs **Garage v2.x**.

## Endpoint and region

| Setting | Typical value |
| --- | --- |
| S3 endpoint | `http://garage:3900` (port from `s3_api.api_bind_addr` in `garage.toml`) |
| Admin API endpoint | `http://garage:3903` (port from `admin.api_bind_addr`) |
| Region | The value of `s3_api.s3_region` in `garage.toml`, commonly `garage` (also Cockpit's default) |

If Cockpit S3 and Garage run on the same Docker network, use the service name. The Garage ports do not need to be exposed to the internet: Cockpit streams downloads and previews itself.

Garage serves path-style requests by default, which is what Cockpit S3 uses.

## Option A — bucket connection with a scoped key

```bash
garage bucket create shared-files
garage key create cockpit-shared-files
garage bucket allow --read --write shared-files --key cockpit-shared-files
garage key info cockpit-shared-files --show-secret
```

- `--read --write` covers browsing, downloads, uploads and deletions. Add `--owner` only if you want to delete the bucket from Cockpit (Garage requires the owner flag for `DeleteBucket`).
- `garage key info ... --show-secret` prints the key ID (`GK...`) and the secret. On older Garage versions the secret is printed by `garage key create` and `--show-secret` may not be needed.
- Repeat `garage bucket allow` for each bucket the key should reach, or create one key per bucket and one connection per key.

Then in Cockpit: **Settings → New connection**, endpoint `http://garage:3900`, region `garage`, the key pair, and optionally the bucket names.

## Option B — cluster (Admin API, Garage v2)

1. Set an admin token in `garage.toml` and restart Garage:

   ```toml
   [admin]
   api_bind_addr = "[::]:3903"
   admin_token = "<output of: openssl rand -base64 32>"
   ```

   Garage v2 can also create additional admin tokens from the CLI (`garage admin-token create`); see the Garage documentation for scopes. The token used by Cockpit must allow cluster status, bucket and key management, because Cockpit creates its own internal S3 key (`CreateKey`) and grants it access to buckets on demand (`AllowBucketKey`).

2. In Cockpit: **Settings (Configurações) → New cluster (Novo cluster)** with:

   | Field | Value |
   | --- | --- |
   | S3 endpoint | `http://garage:3900` |
   | Admin API endpoint | `http://garage:3903` |
   | Region | `garage` |
   | Admin API token | the token from step 1 |

3. Open **Cluster** in the sidebar.

The admin token gives full control over the Garage cluster. Keep it only in Cockpit (it is stored in the database, never returned by the API), do not expose port 3903 publicly, and prefer Option A when you do not need the dashboard.

## Local test setup

The Garage documentation has a ["Quick start"](https://garagehq.deuxfleurs.fr/documentation/quick-start/) that runs a single-node cluster in Docker. After `garage layout assign` and `garage layout apply`, create a bucket and key as in Option A.
