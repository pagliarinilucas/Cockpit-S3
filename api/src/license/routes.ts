// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { Elysia, t } from 'elysia';
import { authDerive, requireAdmin } from '../auth/guard';
import { license } from './service';

export const licenseRoutes = new Elysia({ prefix: '/api' })
  .use(authDerive)
  .get('/edition', () => {
    const s = license.status();
    return { edition: s.edition, features: s.features };
  })
  .guard({ beforeHandle: requireAdmin }, (app) => app
    .get('/license', () => license.status())
    .put('/license', ({ body, set }) => {
      if (license.status().source === 'env') { set.status = 409; return { error: 'license_from_env' }; }
      const status = license.install(body.key);
      if (status.state === 'invalid') { set.status = 400; return { error: 'invalid_license', reason: status.error }; }
      return status;
    }, { body: t.Object({ key: t.String({ minLength: 10, maxLength: 4096 }) }) })
    .delete('/license', ({ set }) => {
      if (license.status().source === 'env') { set.status = 409; return { error: 'license_from_env' }; }
      license.remove();
      return license.status();
    }),
  );
