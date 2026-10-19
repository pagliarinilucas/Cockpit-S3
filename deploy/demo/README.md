# Public demo

This folder runs the public Cockpit S3 demo: the app in `DEMO_MODE`, plus a single-node [Garage](https://garagehq.deuxfleurs.fr/) as the S3 backend, behind a reverse proxy on a small VPS (1 vCPU / 1 GB RAM is enough).

## What demo mode does

With `DEMO_MODE=true` the API:

- **wipes and reseeds everything on boot and every `DEMO_RESET_MINUTES` (default 60):** users, groups, grants, deny blocks, share links, sessions, the activity log, bucket aliases, connections and non-essential settings in SQLite, and every object in the three demo buckets (`acme-contracts`, `marketing-assets`, `finance-reports`). Any other bucket name is refused by the reset code, so it never touches buckets outside that list;
- **recreates fictitious data:** small PDFs, XLSX workbooks, PNGs, CSV and TXT files generated in code, three accounts, a `Finance team` group, a folder-level override (`editor` can write in `finance-reports/drafts/`), a deny block (`viewer` cannot see `acme-contracts/legal-hold/`), five share links (active, expired, revoked and two IP-locked) and a week of backdated activity;
- **publishes the logins** at `GET /api/demo`, which the login screen shows with a "Use" button. Inside the app a slim banner shows the countdown to the next reset;
- **blocks the dangerous operations** with `403 {"error":"demo_readonly"}`: password changes, deleting `admin`/`editor`/`viewer` or changing their role, creating/editing/deleting/testing S3 connections, every write to clusters and revealing key secrets, revealing the KEK, escrow config and backups, license install/remove, SSO/audit/branding settings writes, creating/deleting buckets and toggling bucket encryption;
- **caps uploads** at `DEMO_MAX_UPLOAD_BYTES` (default 5 MiB, `413 demo_upload_too_large`; Bun's request body limit is lowered to match) and **caps new share links at 1 day**, whatever lifetime the visitor picks.

| Account | Password | What it shows |
| --- | --- | --- |
| `admin` | `demo` | Everything: users, groups, permission matrix, activity, cluster dashboard |
| `editor` | `demo` | Read-write on contracts and marketing, read-only on finance through the group, writable `drafts/` folder, can create share links |
| `viewer` | `demo` | View-only on contracts (no download, `legal-hold/` hidden), read-only on marketing, no finance bucket |

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `DEMO_MODE` | `false` | `true` turns everything above on |
| `DEMO_RESET_MINUTES` | `60` | Reset interval |
| `DEMO_MAX_UPLOAD_BYTES` | `5242880` | Upload cap |
| `DEMO_S3_ENDPOINT` | | S3 endpoint of the demo backend (`http://garage:3900` in this compose file) |
| `DEMO_S3_REGION` | `garage` | S3 region |
| `DEMO_S3_ACCESS_KEY` / `DEMO_S3_SECRET_KEY` | | Key with read/write/owner on the three demo buckets |
| `DEMO_GARAGE_ADMIN_ENDPOINT` / `DEMO_GARAGE_ADMIN_TOKEN` | | Optional. Registers the Garage node as a cluster so the Cluster dashboard has data |

## Step by step

### 1. Prepare the VPS

Any Linux VPS with Docker Engine and the Compose plugin, and a DNS record (for example `demo.example.com`) pointing at it. Open only ports 80 and 443.

```bash
git clone https://github.com/pagliarinilucas/Cockpit-S3.git
cd Cockpit-S3/deploy/demo
cp .env.example .env
sed -i "s/^ACCESS_TOKEN_SECRET=.*/ACCESS_TOKEN_SECRET=$(openssl rand -hex 32)/" .env
sed -i "s/^GARAGE_RPC_SECRET=.*/GARAGE_RPC_SECRET=$(openssl rand -hex 32)/" .env
sed -i "s|^GARAGE_ADMIN_TOKEN=.*|GARAGE_ADMIN_TOKEN=$(openssl rand -base64 32)|" .env
sed -i "s|^GARAGE_METRICS_TOKEN=.*|GARAGE_METRICS_TOKEN=$(openssl rand -base64 32)|" .env
sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=https://demo.example.com|" .env
```

If the image is not published on GHCR yet, build it from the repository root with the tag the compose file expects:

```bash
docker build -t ghcr.io/pagliarinilucas/cockpit-s3:latest ../..
```

### 2. Start Garage and create the layout, key and buckets

```bash
docker compose up -d garage
docker compose exec garage /garage status
./init-garage.sh
```

`init-garage.sh` runs these Garage v2 commands inside the container (run it once; `layout apply --version 1` fails on a second run because the layout is already at version 1):

```bash
docker compose exec garage /garage node id -q
docker compose exec garage /garage layout assign -z dc1 -c 1G <node_id>
docker compose exec garage /garage layout apply --version 1
docker compose exec garage /garage key create demo-key
docker compose exec garage /garage bucket create acme-contracts
docker compose exec garage /garage bucket allow --read --write --owner acme-contracts --key demo-key
```

(the last two repeat for `marketing-assets` and `finance-reports`). At the end the script prints `DEMO_S3_ACCESS_KEY=...` and `DEMO_S3_SECRET_KEY=...`. Copy both lines into `.env`. If it cannot parse the `garage key create` output, it prints placeholders instead; copy the `Key ID` and `Secret key` from the output above them, or run `docker compose exec garage /garage key info demo-key --show-secret`.

### 3. Start Cockpit S3

```bash
docker compose up -d cockpit-s3
docker compose logs -f cockpit-s3
```

Look for `[demo] public demo mode on` and `[demo] data reset: 3 users, N objects, 5 share links`. If the reset fails (wrong key, Garage not ready), the log says `[demo] reset failed, retrying soon` and it tries again 30 seconds later.

Quick check from the VPS:

```bash
curl -s http://127.0.0.1:3000/api/demo
```

### 4. Reverse proxy with Caddy

Caddy gets and renews the TLS certificate on its own, forwards `X-Forwarded-For` (used by login throttling and IP-locked share links) and proxies the spreadsheet editor's WebSocket without extra configuration.

`/etc/caddy/Caddyfile`:

```caddy
demo.example.com {
	encode zstd gzip
	request_body {
		max_size 6MB
	}
	reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl reload caddy
```

Keep `request_body.max_size` a little above `DEMO_MAX_UPLOAD_BYTES` so oversized uploads are rejected before they reach the app.

### 5. Updating

```bash
docker compose pull cockpit-s3
docker compose up -d cockpit-s3
```

A restart triggers a reset, so the demo always comes back clean. Garage volumes (`garage_meta`, `garage_data`) keep the layout, key and buckets across updates. To start over completely: `docker compose down -v` and repeat from step 2.

## Things to verify

These details depend on the Garage release and were not checked against a live v2.1.0 node:

- **Environment variables for secrets.** The compose file passes `GARAGE_RPC_SECRET`, `GARAGE_ADMIN_TOKEN` and `GARAGE_METRICS_TOKEN` as environment variables instead of writing them into `garage.toml`. Recent Garage releases read them from the environment. If the container refuses to start with a missing `rpc_secret` error, add `rpc_secret = "..."` at the top level and `admin_token` / `metrics_token` under `[admin]` in `garage.toml`.
- **`garage node id -q` and the `key create` output format** used by `init-garage.sh`. If the output differs, run the commands by hand as listed in step 2.
- **The image tag.** `dxflrs/garage:v2.1.0` is the v2 tag known when this was written. Set `GARAGE_VERSION` in `.env` to pin another v2 release. Cockpit's cluster dashboard uses Garage's v2 admin API, so stay on v2.

## Notes

- With `DEMO_GARAGE_ADMIN_*` set (the default in this compose file), Cockpit creates its own `cockpit-demo` key in Garage once and reuses it across resets.
- The SQLite database lives in the `cockpit_demo_data` volume. Nothing in it survives a reset except the license key (`COCKPIT_LICENSE_KEY`, optional, if you want the Pro features visible in the demo).
- Visitors share the same accounts. One visitor can rename things or revoke links for everyone until the next reset; that is expected.
