# Dokploy

One container, one domain. Dokploy's Traefik terminates TLS.

## A) Compose (recommended)

1. **Create → Compose**, pointing to this repository (branch + root path `/`). Compose path: `./docker-compose.yml` (the root file).
2. **Environment** — add at least:

   ```
   ACCESS_TOKEN_SECRET=<openssl rand -hex 32>
   COOKIE_SECURE=true
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=<a strong password>
   ```

   For SSO (Pro), also set `PUBLIC_URL=https://<your-domain>`.
3. **Domains** — add your domain → service `cockpit-s3`, **port `3000`**, HTTPS on.
4. **Deploy.** The `cockpit_data` volume keeps the database.

## B) Application (Dockerfile)

1. **Create → Application**, this repository, **Build type: Dockerfile** (root `Dockerfile`).
2. Add the same environment variables.
3. Add a **Volume**: mount path `/data`, so the SQLite database persists.
4. **Domain** → port `3000`, HTTPS on. Deploy.

## Notes

- `ACCESS_TOKEN_SECRET` is required in production; the API exits on boot if it is missing or shorter than 32 characters.
- `COOKIE_SECURE=true` is required because the refresh-token cookie is only sent over HTTPS.
- Back up the `/data` volume (`cockpit.sqlite`). Enable the encrypted DR backup in the UI if you use encryption at rest.
- S3 connections are configured in the UI; no S3 credentials go into environment variables.
