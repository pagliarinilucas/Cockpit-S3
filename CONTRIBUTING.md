# Contributing to Cockpit S3

Thanks for your interest. Bug reports, documentation fixes, provider guides and code are all welcome.

## Before you start

- **Security issues:** do not open a public issue. Follow [`SECURITY.md`](./SECURITY.md).
- **Larger changes:** open an issue or a discussion first, so we can agree on the approach before you spend time on it.
- **Contributor License Agreement:** every pull request from someone other than the maintainer must be covered by a signed [CLA](./CLA.md). You keep the copyright in your work; the CLA lets the project ship it under both the AGPL and the commercial license. The CLA Assistant bot comments on your first pull request; sign by replying:

  > I have read the CLA Document and I hereby sign the CLA

  One signature covers all your future contributions.

## Development setup

Requirements: [Bun](https://bun.sh) 1.x and Git. Docker is optional (for building the production image).

On NixOS, or anywhere Nix is available, run `nix develop` first. The dev shell provides Bun, Node 22 and the `LD_LIBRARY_PATH` that the native `sodium-native` addon needs; without it, tests fail with `libstdc++.so.6: cannot open`. On regular glibc distributions and macOS this is not needed.

```bash
git clone https://github.com/pagliarinilucas/Cockpit-S3.git
cd Cockpit-S3
bun run install:all            # packages/sheet, api, web

# terminal 1 — API on :3000 (watch mode)
cd api && cp .env.example .env && bun run dev

# terminal 2 — web on :4200, proxies /api to :3000
cd web && bun run dev
```

On first boot the API creates an admin from `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `api/.env`; a blank password generates a random one printed in the log. Add an S3 connection in the UI under **Settings (Configurações) → New connection (Nova conexão)**. A local Garage or MinIO in Docker is the easiest backend for development; see [`docs/quickstart/`](./docs/quickstart/).

Repository layout:

| Path | What |
| --- | --- |
| `api/` | Elysia + Bun API, SQLite via Drizzle. See [`api/README.md`](./api/README.md). |
| `web/` | Vue 3 + Vite SPA. See [`web/README.md`](./web/README.md). |
| `packages/sheet/` | xlsx parsing shared by the API and the browser. |
| `docs/` | Documentation. |
| `deploy/` | Deployment templates. |
| `scripts/` | Repository tooling (license audit). |

## Checks

Run these from the repository root before opening a pull request:

```bash
bun run typecheck    # packages/sheet, api, web
bun run test         # packages/sheet, api, web
```

Notes:

- Integration and load tests in `api/src/storage/` need a real S3 endpoint and are skipped unless `S3_TEST_ENDPOINT` and related variables are set. See [`docs/encryption.md`](./docs/encryption.md) for the variables.
- If you add or upgrade a production dependency, run `bun run license:audit` and commit the regenerated [`docs/dependency-licenses.md`](./docs/dependency-licenses.md). Dependencies must use a permissive license (MIT, ISC, Apache-2.0, BSD, etc.); anything else needs discussion first, because the project is also distributed under a commercial license.
- Database schema changes: edit `api/src/db/schema.ts` and run `bun run db:generate` in `api/`.

## Code style

- TypeScript everywhere, strict type checking must pass.
- New source files start with the SPDX header:

  ```ts
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Copyright (C) 2026 Lucas Pagliarini
  ```

- Authorization belongs on the server. A UI change that hides a button must be backed by a check in the API.
- Keep changes focused; one topic per pull request.

## Commits

The history uses [Conventional Commits](https://www.conventionalcommits.org/) with a scope:

```
feat(sheet): resize columns and rows, saved to the file
fix(web): download from search results outside the granted folder
docs(readme): product overview with screenshots
refactor(sheet): extract @cockpit/sheet package
test(web): DOM harness for the grid
chore(dev): vite ports from the environment
fix(build): docker image needs the shared xlsx modules
```

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`. Common scopes: `api`, `web`, `sheet`, `preview`, `build`, `dev`, `readme`. Messages may be written in English or Portuguese; describe what changed and why in the body when it is not obvious.

## Pull requests

1. Fork and create a branch from `main` (`feat/...`, `fix/...`, `docs/...`).
2. Make your change with tests where it makes sense.
3. Run `bun run typecheck` and `bun run test`.
4. Open the pull request and fill in the template. Sign the CLA when the bot asks.

## Questions

Use [GitHub Discussions](https://github.com/pagliarinilucas/Cockpit-S3/discussions) or email cockpits3@pm.me.
