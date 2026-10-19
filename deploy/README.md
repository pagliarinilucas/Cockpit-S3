# Deployment

Cockpit S3 is a single container: the Bun API serves the web app on port `3000` and keeps its state in a SQLite file under `/data`. Every deployment needs the same three things:

1. **An `ACCESS_TOKEN_SECRET`** of at least 32 characters (`openssl rand -hex 32`). The API refuses to start in production without it.
2. **A persistent volume at `/data`.** Users, permissions, connections, share links and the audit log live there.
3. **HTTPS in front**, with `COOKIE_SECURE=true` (the default). Use `COOKIE_SECURE=false` only for plain HTTP on localhost.

There is no published image yet; every option below builds the root `Dockerfile`.

| Target | Files |
| --- | --- |
| Plain Docker | [Quickstart in the README](../README.md#-quickstart) |
| Docker Compose (production) | [`compose/docker-compose.yml`](./compose/docker-compose.yml), [`compose/.env.example`](./compose/.env.example), optional [`compose/docker-compose.kek.yml`](./compose/docker-compose.kek.yml) |
| Coolify | [`coolify/README.md`](./coolify/README.md) |
| Dokploy | [`dokploy/README.md`](./dokploy/README.md) |
| Railway | [`railway/README.md`](./railway/README.md), [`railway/railway.json`](./railway/railway.json) |

## Docker Compose

```bash
cd deploy/compose
cp .env.example .env
sed -i "s/^ACCESS_TOKEN_SECRET=.*/ACCESS_TOKEN_SECRET=$(openssl rand -hex 32)/" .env
docker compose up -d
docker compose logs cockpit-s3 | grep -i senha
```

What the compose file does:

- pulls `ghcr.io/pagliarinilucas/cockpit-s3` (pin a release with `COCKPIT_VERSION=1.0.0` in `.env`; default `latest`);
- `restart: unless-stopped`;
- healthcheck on `GET /api/health` every 30 seconds;
- named volume `cockpit_data` mounted at `/data`;
- publishes the port on `127.0.0.1:3000` only, for a reverse proxy on the same host. Set `BIND_ADDRESS=0.0.0.0` in `.env` to expose it directly (not recommended without TLS);
- log rotation (5 × 10 MB).

`ACCESS_TOKEN_SECRET` is mandatory; `docker compose` stops with an error if it is empty.

### Reverse proxy

Any proxy that forwards to `127.0.0.1:3000` works. Caddy example:

```
files.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

Uploads have no artificial size limit in Cockpit S3; if your proxy has one (nginx `client_max_body_size`), raise it.

### Encryption at rest

To enable encryption at rest, provide a 32-byte key-encryption key (KEK) as a Docker secret:

```bash
mkdir -p secrets && openssl rand -base64 32 > secrets/cockpit_kek && chmod 600 secrets/cockpit_kek
docker compose -f docker-compose.yml -f docker-compose.kek.yml up -d
```

Back up the KEK offline. Losing it makes encrypted objects unreadable. See [`docs/encryption.md`](../docs/encryption.md).

### License key

Set `COCKPIT_LICENSE_KEY` in `.env`, or paste the key in **Settings → License** in the UI. See [`docs/licensing.md`](../docs/licensing.md).

## Upgrades

```bash
docker compose pull
docker compose up -d
```

The API creates or updates its tables on boot. Check the release notes for any manual step, and snapshot the `cockpit_data` volume before upgrading.

## Backups

```bash
docker run --rm -v cockpit-s3_cockpit_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/cockpit-data-$(date +%F).tgz -C /data .
```

The volume name is `<project>_cockpit_data`; with this compose file the project is `cockpit-s3`. Your files are in your S3 storage and are not part of this backup.

## Constraints

- **One replica.** SQLite is a single-writer, single-host database; do not run several replicas against the same volume. High availability with Postgres is on the Enterprise roadmap.
- **Network.** The container must reach your S3 endpoints. Users' browsers only need to reach Cockpit S3.
