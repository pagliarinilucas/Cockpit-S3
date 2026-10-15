# Coolify

Two ways to deploy Cockpit S3 on Coolify (v4). Both build the image from your fork of this repository.

## A) Dockerfile build pack (simplest)

1. **+ New → Application → Public/Private repository**, select the repository and branch.
2. **Build pack: Dockerfile**, base directory `/`, Dockerfile location `/Dockerfile`.
3. **Ports exposed:** `3000`.
4. **Domains:** your domain with `https://`. Coolify's proxy issues the certificate and terminates TLS.
5. **Environment variables:**

   ```
   ACCESS_TOKEN_SECRET=<openssl rand -hex 32>
   COOKIE_SECURE=true
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=<a strong password>
   PUBLIC_URL=https://<your-domain>
   ```

6. **Persistent storage:** add a volume with destination path `/data`.
7. **Healthcheck:** the image already defines one (`GET /api/health`). If you configure Coolify's own healthcheck, use path `/api/health`, port `3000`.
8. Deploy, then read the logs for the generated admin password if you left `ADMIN_PASSWORD` empty.

## B) Docker Compose build pack

1. **+ New → Application**, select the repository, **Build pack: Docker Compose**.
2. Docker Compose location: `/deploy/compose/docker-compose.yml` (its build context points to the repository root).
3. Set the same environment variables in Coolify. `BIND_ADDRESS` and `HOST_PORT` are only relevant outside Coolify; Coolify routes the domain to the container port.
4. Assign your domain to the `cockpit-s3` service on port `3000`.

The `cockpit_data` volume from the compose file holds the database.

## Notes

- Keep a single instance: the SQLite database cannot be shared between replicas.
- Back up the `/data` volume (Coolify's scheduled backups cover databases it manages, not arbitrary app volumes; use a volume or host-level backup).
