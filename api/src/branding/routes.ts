// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { Elysia, t } from 'elysia';
import { authDerive, requireAdmin } from '../auth/guard';
import { license, requireFeature } from '../license/service';
import { brandingStore, BrandingError, MAX_LOGO_BYTES, type BrandingSettings } from './store';

const MAX_LOGO_DATA_URL_LENGTH = Math.ceil(MAX_LOGO_BYTES / 3) * 4 + 64;

function adminView(stored: BrandingSettings) {
  return {
    ...stored,
    licensed: license.has('branding'),
    whiteLabel: license.has('white-label'),
  };
}

export const brandingRoutes = new Elysia({ prefix: '/api' })
  .get('/branding', ({ set }) => {
    set.headers['cache-control'] = 'no-cache';
    return brandingStore.effective();
  })
  .use(authDerive)
  .guard({ beforeHandle: requireAdmin }, (app) => app
    .get('/branding/settings', () => adminView(brandingStore.get()))
    .put('/branding/settings', (ctx) => {
      const blocked = requireFeature('branding')(ctx);
      if (blocked) return blocked;
      try {
        return adminView(brandingStore.update(ctx.body));
      } catch (e) {
        if (!(e instanceof BrandingError)) throw e;
        ctx.set.status = e.code === 'logo_too_large' ? 413 : 400;
        return { error: e.code };
      }
    }, {
      body: t.Object({
        productName: t.Optional(t.String({ maxLength: 200 })),
        accentColor: t.Optional(t.Nullable(t.String({ maxLength: 16 }))),
        logo: t.Optional(t.Nullable(t.String({ maxLength: MAX_LOGO_DATA_URL_LENGTH * 2 }))),
        sharePageMessage: t.Optional(t.String({ maxLength: 1000 })),
        hidePoweredBy: t.Optional(t.Boolean()),
      }),
    })
    .delete('/branding/logo', () => adminView(brandingStore.removeLogo())),
  );
