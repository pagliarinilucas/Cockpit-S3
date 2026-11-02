// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { Elysia } from 'elysia';
import { config } from '../config';
import { DEMO_ACCOUNTS } from './catalog';
import { demoRejection } from './guard';
import { demoNextResetAt } from './reset';

export function demoInfo() {
  if (!config.demo.enabled) return { enabled: false as const };
  return {
    enabled: true as const,
    resetMinutes: config.demo.resetMinutes,
    nextResetAt: demoNextResetAt()?.toISOString() ?? null,
    accounts: DEMO_ACCOUNTS.map(({ username, password, role, description }) => ({ username, password, role, description })),
  };
}

export const demoRoutes = new Elysia({ name: 'demo-mode' })
  .onRequest(async ({ request, set }) => {
    const rejection = await demoRejection(request);
    if (!rejection) return;
    set.status = rejection.status;
    return rejection.body;
  })
  .get('/api/demo', ({ set }) => {
    set.headers['cache-control'] = 'no-store';
    return demoInfo();
  });
