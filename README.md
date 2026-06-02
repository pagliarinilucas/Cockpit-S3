# Cockpit S3 — monorepo

Garage S3 storage console with a **truck-cockpit** look. Two apps, one repo:

```
cockpit-s3/
├── web/            Vue 3 + Vite + TypeScript SPA (runs on Bun)
├── api/            Elysia + Bun API (auth, S3, SQLite)
├── Dockerfile      builds web, then runs api serving the built SPA
├── docker-compose.yml
└── .env.example
```

In **production** the API serves the built SPA from the same origin (no CORS, one
port, one volume), so the whole thing ships as a **single container**.

## Develop (Bun, two processes)

```bash
# terminal 1 — API on :3000
cd api && bun install && bun run dev

# terminal 2 — web on :4200 (proxies /api → :3000)
cd web && bun install && bun run dev
```

Open http://localhost:4200. First boot creates an admin from `api/.env`
(`ADMIN_USERNAME`/`ADMIN_PASSWORD`; blank password → a random one is printed).
Add your Garage/S3 connection in **Conexões** (admin).

From the repo root you can also use `bun run dev:api` / `bun run dev:web`.

## Run the production image locally

```bash
cp .env.example .env          # set ACCESS_TOKEN_SECRET (openssl rand -hex 32)
docker compose up -d --build
# → http://localhost:3000   (web + /api on the same origin)
docker compose logs -f        # grab the random admin password if you left it blank
```

State (the SQLite DB) lives in the `cockpit_data` volume — connections, users and
sessions survive restarts and redeploys.

## Deploy on Dokploy

Single container, single domain. Two ways:

### A) Compose (recommended — uses `docker-compose.yml`)

1. **Create → Compose**, point it at this repo (branch + root path `/`).
2. **Environment** — add at least:
   ```
   ACCESS_TOKEN_SECRET=<openssl rand -hex 32>
   COOKIE_SECURE=true
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=<a strong password>
   ```
3. **Domains** — add your domain → service `cockpit-s3`, **port `3000`**, enable
   HTTPS. Dokploy's proxy terminates TLS (so `COOKIE_SECURE=true` is correct).
4. **Deploy.** The `cockpit_data` volume persists the database.

### B) Application (Dockerfile)

1. **Create → Application**, this repo, **Build type: Dockerfile** (root `Dockerfile`).
2. Add the same env vars as above.
3. Add a **Volume**: mount path `/data` (so the SQLite DB persists).
4. **Domain** → port `3000`, HTTPS on. Deploy.

### Notes

- **`ACCESS_TOKEN_SECRET` is mandatory in production** — the API exits on boot if it's
  missing or shorter than 32 chars. Don't reuse the dev one.
- **`COOKIE_SECURE=true`** is required because the refresh-token cookie is only sent
  over HTTPS; Dokploy serves your domain over TLS.
- **Backups**: snapshot the `/data` volume (`cockpit.sqlite`).
- Garage/S3 connections are configured in the UI and stored in the DB — no S3
  credentials in env needed.

## What's inside

- `web/` — see [`web/README.md`](./web/README.md) and the API contract in
  [`web/API.md`](./web/API.md).
- `api/` — see [`api/README.md`](./api/README.md) (auth design, layout, routes).
