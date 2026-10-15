# Security policy

## Supported versions

Cockpit S3 does not yet publish versioned releases on a fixed schedule. Security fixes are made on the `main` branch and included in the next release.

| Version | Supported |
| --- | --- |
| Latest release / `main` | ✅ |
| Older releases | ❌ — upgrade to the latest release |

Pro and Enterprise customers with an active license receive fixes through the regular releases. Enterprise agreements may define backports to specific versions.

## Reporting a vulnerability

**Do not open a public issue for security problems.**

Report privately through one of:

- Email: **cockpits3@pm.me** (subject starting with `[security]`)
- GitHub private vulnerability reporting: **Security → Report a vulnerability** on <https://github.com/pagliarinilucas/Cockpit-S3/security/advisories/new>

Please include:

- affected version or commit;
- a description of the issue and its impact;
- steps to reproduce or a proof of concept;
- your deployment details if relevant (reverse proxy, S3 provider, encryption enabled or not);
- whether and how you want to be credited.

### What to expect

| Step | Target |
| --- | --- |
| Acknowledgement | within **72 hours** |
| Triage and severity assessment | within **7 days** |
| Fix or mitigation | depends on severity; critical issues are prioritized over all other work |
| Public disclosure | coordinated with you, after a fix is available |

We publish a GitHub security advisory for confirmed vulnerabilities and credit reporters who want to be credited.

## Scope

In scope:

- **Authentication** — login, password hashing, access/refresh tokens, session revocation, rate limiting, SSO/OIDC flows.
- **Authorization / permission bypass** — reading, downloading, writing or deleting objects outside the granted bucket, folder or level; a `view-only` user obtaining file bytes; non-admins reaching admin endpoints; group and block resolution errors.
- **Public share links** — guessing or enumerating tokens, using a link after expiry or revocation, bypassing the IP lock, reaching other objects from a share.
- **Path traversal** — object keys, prefixes, ZIP entry names, spreadsheet and upload handling that escape the intended prefix or the server filesystem.
- **Cryptography** — encryption at rest, key wrapping, the DR/escrow backup bundle, license key verification.
- **Leaking secrets** — S3 credentials, admin tokens, recovery codes or license data returned by the API or written to logs.
- XSS, CSRF, SSRF (e.g. via connection or webhook URLs) and injection in the web UI and API.

Out of scope:

- Vulnerabilities in the S3 server you connect to (report them to that project), or in your reverse proxy.
- Attacks that require an already compromised host or full admin access to the console.
- Missing hardening headers without a demonstrated impact, self-XSS, clickjacking on pages without sensitive actions.
- Denial of service through volumetric traffic.
- Findings from automated scanners without a working proof of concept.
- Running without TLS, or with `COOKIE_SECURE=false`, in production.

## Safe harbor

We will not pursue legal action against anyone who, in good faith:

- reports a vulnerability through the channels above;
- tests only against their own installation, or data they own or are authorized to use;
- avoids privacy violations, data destruction and service degradation;
- gives us reasonable time to fix the issue before any public disclosure.

If in doubt about whether an action is acceptable, ask first at cockpits3@pm.me.

## Bug bounty

There is no paid bug bounty program at this time. We credit reporters in the advisory and release notes.

## Security architecture (summary)

- **Authorization** is enforced server-side on every route and resolved per object key: a user-level block is absolute; otherwise the highest grant (direct or via groups) whose prefix covers the key wins. Admins own all buckets.
- **Passwords** are hashed with argon2id. Login is rate-limited per user and IP.
- **Access tokens** are short-lived HS256 JWTs (15 min by default) carrying a version claim checked on every request; bumping the version (logout-all, password change, admin reset) invalidates every outstanding token.
- **Refresh tokens** are opaque, rotated on each use, stored only as SHA-256 hashes, sent in an httpOnly `SameSite=Strict` cookie scoped to `/api/auth`. Reusing a rotated token revokes the whole token family.
- **Share links** carry a random token, an expiry (1 h – 30 days), optional first-IP lock and can be revoked; only users with the share permission can create them, and only for files they can download.
- **S3 credentials** are stored in the SQLite database and never returned by the API. Downloads and previews are streamed through the API, so the S3 endpoint does not need to be reachable from browsers.
- **Encryption at rest** (optional, per bucket): each object gets its own data key, wrapped by a key-encryption key (KEK) supplied through `COCKPIT_KEK_FILE` or `COCKPIT_KEK`. See [`docs/encryption.md`](./docs/encryption.md).
- **DR backup**: the KEK and the database are encrypted into a bundle that opens only with the customer recovery code (and, optionally, a vendor key). See [`docs/encryption.md`](./docs/encryption.md).
- **License keys** are Ed25519-signed and verified offline; the instance makes no outbound call for licensing.

Details and deployment recommendations: [`docs/security.md`](./docs/security.md).
