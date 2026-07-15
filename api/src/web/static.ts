// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { Elysia } from 'elysia';
import { join, normalize } from 'node:path';
import { config } from '../config';

/**
 * Serves the built SPA (config.webDir) for any non-/api route, with an index.html
 * fallback for client-side routing. No-op when WEB_DIR is unset (dev: Vite serves
 * the front and proxies /api here). Single-container production: WEB_DIR=/app/public.
 */
export const staticRoutes = new Elysia();

if (config.webDir) {
  const root = config.webDir;
  const indexFile = () => Bun.file(join(root, 'index.html'));

  staticRoutes.get('/*', async ({ request, set }) => {
    const path = decodeURIComponent(new URL(request.url).pathname);
    if (path.startsWith('/api')) { set.status = 404; return { error: 'not_found' }; }

    // Resolve within root and block path traversal.
    const rel = normalize(path).replace(/^(\.\.(\/|\\|$))+/, '');
    if (rel !== '/' && rel !== '\\') {
      const file = Bun.file(join(root, rel));
      if (await file.exists()) return file;
    }
    return indexFile();   // SPA fallback (the app uses hash routing)
  });
}
