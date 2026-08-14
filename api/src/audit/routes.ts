// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { Elysia } from 'elysia';
import { authDerive, requireUser } from '../auth/guard';
import { audit } from './store';

export const activityRoutes = new Elysia({ prefix: '/api' })
  .use(authDerive)
  .guard({ beforeHandle: requireUser }, (app) =>
    app.get('/activity', () => audit.list()),
  );
