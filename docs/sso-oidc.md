# Single sign-on (OIDC)

Cockpit S3 Pro can sign users in through any OpenID Connect provider using the
authorization code flow with PKCE (S256), `state` and `nonce`. The `id_token` is
verified against the provider's JWKS (`iss`, `aud`, `exp`, `nonce`).

SSO requires a license that includes the `sso` feature (Pro or Enterprise). Without
it the login button is hidden and the settings are read-only.

## 1. Set the public URL

The redirect URI is built from `PUBLIC_URL`:

```
PUBLIC_URL=https://cockpit.example.com
```

The redirect URI to register at the provider is then:

```
https://cockpit.example.com/api/auth/oidc/callback
```

When `PUBLIC_URL` is empty the API derives the origin from `X-Forwarded-Proto` /
`X-Forwarded-Host` (or `Host`). Setting it explicitly is recommended. In local
development with the Vite dev server set `PUBLIC_URL=http://localhost:4200`, because
the Vite proxy rewrites the `Host` header to the API port.

The exact URI is shown (with a copy button) in **Configurações → Single sign-on (OIDC)**.

## 2. Configure Cockpit S3

In **Configurações → Single sign-on (OIDC) → Configurar**:

| Field | Meaning |
| --- | --- |
| Issuer | Base issuer URL. Discovery is read from `<issuer>/.well-known/openid-configuration`. Use **Testar descoberta** to check it. |
| Client ID / secret | Credentials of a confidential client. The secret is never sent back to the browser. |
| Scopes | Default `openid email profile`. Add `groups` when the provider needs it to emit a groups claim. |
| Username claim | Claim mapped to the Cockpit username. Default `preferred_username`, falling back to `email`. |
| Allowed e-mail domains | Optional. When set, the `email` claim must belong to one of them (exact domain match, `email_verified` must not be `false`). |
| Auto-provision | Off by default: only usernames that already exist in Cockpit can sign in. When on, unknown users are created with role `user` and a random, unusable password. |
| Admin group | Optional. If the `groups` claim contains this value **when the account is created**, the user becomes `admin`. Existing accounts are never promoted or demoted by SSO. |
| Disable password login | When on (and SSO is active), password login is refused for non-admin users. |

The client authentication method (`client_secret_basic` or `client_secret_post`) is
picked from the provider's `token_endpoint_auth_methods_supported`.

The username claim must be one users cannot edit themselves at the provider: a
matching username grants access to the existing Cockpit account of the same name,
including admin accounts.

## Provider notes

### Google Workspace

1. Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID →
   *Web application*.
2. Authorized redirect URI: `https://cockpit.example.com/api/auth/oidc/callback`.
3. Issuer: `https://accounts.google.com`.
4. Scopes: `openid email profile`.
5. Username claim: `email` (Google does not send `preferred_username`; the fallback to
   `email` also works).
6. Set **Allowed e-mail domains** to your Workspace domain, otherwise any Google account
   can authenticate (and, with auto-provision, get an account).
7. Google does not emit a groups claim, so **Admin group** has no effect.

### Microsoft Entra ID

1. Entra admin center → App registrations → New registration. Platform *Web*,
   redirect URI `https://cockpit.example.com/api/auth/oidc/callback`.
2. Certificates & secrets → new client secret.
3. Issuer: `https://login.microsoftonline.com/<tenant-id>/v2.0` (use the tenant ID, not
   `common` or `organizations`, so the issuer matches the token).
4. Scopes: `openid email profile`.
5. Username claim: `preferred_username` (the UPN) or `email`.
6. Groups: Token configuration → Add groups claim. Entra emits group **object IDs** by
   default, so put the group's object ID in **Admin group** (or configure the claim to
   emit `sAMAccountName` for synced groups).

### Keycloak

1. Realm → Clients → Create client, type *OpenID Connect*, client authentication on,
   standard flow on.
2. Valid redirect URIs: `https://cockpit.example.com/api/auth/oidc/callback`.
3. Issuer: `https://keycloak.example.com/realms/<realm>`.
4. Scopes: `openid email profile`.
5. Username claim: `preferred_username`.
6. Groups: Client scopes → `<client>-dedicated` → Add mapper → *Group Membership*, token
   claim name `groups`, *Full group path* off. Put the group name in **Admin group**.

### Authentik

1. Applications → Providers → Create *OAuth2/OpenID Provider*, client type
   *Confidential*.
2. Redirect URIs: `https://cockpit.example.com/api/auth/oidc/callback`.
3. Create an Application bound to the provider (slug e.g. `cockpit`).
4. Issuer: `https://authentik.example.com/application/o/cockpit/` (trailing slash
   included, as shown in the provider overview).
5. Scopes: `openid email profile`. The default `profile` scope mapping already includes
   a `groups` claim with group names.
6. Username claim: `preferred_username`.

## Break-glass access

**Disable password login** never applies to admins: administrators can always sign in
with their local password, so a misconfigured or unavailable identity provider cannot
lock everyone out. Keep at least one admin with a strong local password.

If the license expires without covering the running version, SSO turns off and password
login is accepted again for every user.

## Error codes

Failures redirect to `/?sso_error=<code>` without details; the API logs the cause.

| Code | Meaning |
| --- | --- |
| `disabled` | SSO not configured, disabled or not licensed. |
| `discovery` | Discovery document could not be fetched. |
| `idp` | The provider returned an error (e.g. the user cancelled). |
| `state` | Missing, expired (10 min), replayed or browser-mismatched `state`. |
| `token` | Code exchange or `id_token` validation failed. |
| `no_username` | Neither the configured claim nor `email` was present. |
| `domain` | E-mail domain not in the allow-list. |
| `not_provisioned` | User does not exist and auto-provision is off. |
| `inactive` | The Cockpit account is deactivated. |

## Limitations

- Pending logins are kept in memory, so a restart during the provider round-trip
  invalidates it, and the API must run as a single instance (as it already does with
  SQLite).
- Logging out of Cockpit does not end the session at the provider (no RP-initiated
  logout).
- Roles are only set from the admin group when the account is created.
