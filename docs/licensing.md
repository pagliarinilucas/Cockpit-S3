# Licensing and license keys

Cockpit S3 ships **one binary for every edition**. Without a license key it runs as Community under the AGPL-3.0. A Pro or Enterprise key unlocks the paid features and puts the instance under the commercial license.

## Editions

| Edition | License | Unlocks |
| --- | --- | --- |
| Community | AGPL-3.0-or-later | Full core: unlimited users, permission matrix with folder overrides, groups, expiring/IP-locked share links, previews, spreadsheet editor, audit log in the UI, Garage dashboard, multiple connections, encryption at rest, DR backup |
| Pro | Commercial | Community + SSO via OIDC ([`sso-oidc.md`](./sso-oidc.md)), audit export (CSV/JSON/NDJSON) with retention and webhook/syslog forwarding, basic branding (logo, accent color, name) |
| Enterprise | Commercial, negotiated | Pro + white-label (hide "powered by"), plus contract terms (SLA, OEM/redistribution) |

Prices: [README → Editions & pricing](../README.md#pricing). Terms summary: [`COMMERCIAL-LICENSE.md`](../COMMERCIAL-LICENSE.md).

## Getting a key

Email **cockpits3@pm.me** with the company name and the number of production instances. After payment you receive a key that starts with `CS3-`.

## Activating a key

Choose one of:

**1. In the UI** — as an admin, **Settings (Configurações) → License (Licença)**, paste the key and save. It is stored in the database and survives restarts and upgrades.

**2. Environment variable**

```bash
COCKPIT_LICENSE_KEY=CS3-...
```

**3. File** (recommended with Docker or Kubernetes secrets)

```bash
COCKPIT_LICENSE_FILE=/run/secrets/cockpit_license
```

Precedence: `COCKPIT_LICENSE_FILE`, then `COCKPIT_LICENSE_KEY`, then the key saved in the UI. When the key comes from the environment, the UI shows it read-only and cannot replace or remove it.

Compose example:

```yaml
services:
  cockpit-s3:
    environment:
      COCKPIT_LICENSE_FILE: /run/secrets/cockpit_license
    secrets:
      - cockpit_license

secrets:
  cockpit_license:
    file: ./cockpit_license.txt
```

The License panel shows the licensee, the expiry date and whether the key covers the running version. `GET /api/license` (admin) returns the full status, including edition, release date and active features.

## Offline verification

- A key is a JSON payload (licensee, edition, issue and expiry dates, optional instance label and extra features) signed with **Ed25519**.
- The instance verifies the signature with a public key embedded in the build. No network call is made: there is no activation server, phone-home or telemetry. Air-gapped installations work the same way.
- A key with an invalid signature or an unknown format is rejected and the instance stays on Community.

## Expiry

Every key has an expiry date (the end of the paid term). Each Cockpit S3 release carries its own release date.

| Situation | Result |
| --- | --- |
| Before the expiry date | Pro/Enterprise features active on any release. |
| After the expiry date, running a release published **on or before** the expiry date | Features **stay active**. You keep the versions you paid for, indefinitely. |
| After the expiry date, running a release published **after** the expiry date | Features are not active; the instance runs as Community. Renew to get a key covering the new release. |

Nothing is deleted when features turn off. SSO, audit export and branding settings are kept in the database and come back when a valid key is installed. If you rely on SSO, make sure an admin can still log in with a password before upgrading past your expiry date.

## Instances

A Pro license covers one **production instance**: one deployment, with its own database, serving one production environment. Staging, development and test instances do not need an extra license. See the definition in [`COMMERCIAL-LICENSE.md`](../COMMERCIAL-LICENSE.md#definitions).

## Questions

cockpits3@pm.me
