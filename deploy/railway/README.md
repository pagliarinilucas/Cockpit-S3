# Railway

Railway builds the root `Dockerfile` from your fork of the repository.

1. **New Project → Deploy from GitHub repo**, select your fork.
2. Service **Settings → Config-as-code**: set the file path to `/deploy/railway/railway.json`. It sets the Dockerfile builder, one replica, the `/api/health` healthcheck and the restart policy.
3. **Variables:**

   ```
   ACCESS_TOKEN_SECRET=<openssl rand -hex 32>
   COOKIE_SECURE=true
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=<a strong password>
   PUBLIC_URL=https://<your-domain>
   ```

   Railway injects `PORT`; Cockpit S3 listens on it.
4. **Volume:** right-click the service → **Attach volume**, mount path `/data`. Without a volume the database (users, connections, permissions) is lost on every deploy. Volumes cannot be declared in `railway.json`.
5. **Networking → Generate domain** (or add a custom domain). Railway terminates TLS, so `COOKIE_SECURE=true` is correct.

Notes:

- Keep **one replica**: the SQLite database lives on the volume of a single instance.
- If your S3 storage is outside Railway, downloads through Cockpit count as Railway egress.
- License key: add `COCKPIT_LICENSE_KEY` as a variable, or paste it in **Settings → License** in the UI.
