# Cockpit S3

A storage console for Garage S3 with a **truck-cockpit** look — deep, dark panels,
neon instrument accents, monospace readouts. **Vue 3 + Vite + TypeScript, running on
[Bun](https://bun.sh).**

This is the **frontend**. It talks to a real backend API (nothing is mocked) at
**`http://localhost:3000`** in development — the **`../cockpit-s3-api`** project (Elysia
on Bun) implements it. The full contract is documented in [`API.md`](./API.md) (types in
`src/core/models.ts`). If the backend isn't running, the views render their
loading / empty / "API indisponível" states.

**Auth:** short-lived access token (Bearer, in memory) + rotating refresh-token cookie,
with transparent refresh-on-401. See `src/core/api.ts` and the backend README.

## Features (all wired to the API)

- **Login** — cookie session via `POST /api/login`.
- **Buckets** — grid of bucket cards with usage gauges + a cluster panel (capacity
  gauge, readouts, per-node load).
- **Files** — list/grid browser with breadcrumbs, in-folder search, multi-select,
  drag-and-drop **upload** (real progress dock via XHR), **new folder**, **delete**,
  **download** and **copy presigned link**, plus batch download/delete. Write actions
  hide automatically on read-only buckets.
- **Preview lightbox** — opens **images, video, audio and PDF inline** (no download),
  via presigned inline URLs, with ←/→ navigation across the folder.
- **Access keys** — Garage-style permission matrix; click a cell to cycle
  none → read-only → read/write → owner.
- **Users (admin)** — only for `admin` accounts: create users (username + password +
  role), reset password, delete, and a user × bucket permission matrix.
- **Conexões (admin)** — manage **multiple** Garage/S3 connections (add/edit/delete +
  test connection) from the UI. Saved server-side; secrets never sent back. Buckets are
  addressed as `<connectionId>:<bucketName>` across all connections.
- **Activity** — audit timeline.
- **Themes** — five dark themes (Graphite, Cobalt, Hauler, Cargo, Carbon) + a CRT
  scanline toggle, from the floating palette button (bottom-right), persisted in
  `localStorage`.

## Develop (Bun)

```bash
bun install
bun run dev        # Vite dev server on http://localhost:4200
```

`/api/*` is proxied to `http://localhost:3000` (see `vite.config.ts`). Point that at
your backend, or change the target there.

> Everything runs on the Bun runtime — `bun run dev` / `bun run build` execute Vite
> under Bun, no Node required.

## Build

```bash
bun run build      # vue-tsc type-check + vite build → dist/
bun run preview    # serve the production build
```

## Where things live

```
src/core/            models (API contract), api client, theme & toast, perm, utils, icons
src/components/       Icon, Gauge, LevelBar, PermBadge, Modal, InputModal, Toasts, ThemePanel
src/views/           Login, Buckets, Files, Keys, Users, Settings, Activity, Preview, UploadDock
src/App.vue          shell: sidebar + topbar + view switching
src/styles.css       the whole cockpit theme + the [data-theme] variable sets
vite.config.ts       Vue plugin + dev proxy to :3000
```
