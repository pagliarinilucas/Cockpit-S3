// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { Elysia, t } from 'elysia';
import { authDerive, requireAdmin, type AuthUser } from '../auth/guard';
import { license, requireFeature } from '../license/service';
import { audit, ACTIVITY_DEFAULT_LIMIT, type ActivityFilter } from './store';
import { exportResponse, EXPORT_FORMATS, type ExportFormat } from './export';
import { auditSettings, AuditSettingsError, MAX_RETENTION_DAYS } from './settings';
import { forwardStats, sendTestEvent } from './forward';

const filterQuery = {
  since: t.Optional(t.String({ maxLength: 64 })),
  until: t.Optional(t.String({ maxLength: 64 })),
  actor: t.Optional(t.String({ maxLength: 200 })),
  action: t.Optional(t.String({ maxLength: 64 })),
  bucket: t.Optional(t.String({ maxLength: 300 })),
};

interface RawFilter {
  since?: string;
  until?: string;
  actor?: string;
  action?: string;
  bucket?: string;
}

class InvalidFilterError extends Error {}

function isoOrUndefined(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new InvalidFilterError(value);
  return new Date(parsed).toISOString();
}

function parseFilter(query: RawFilter): ActivityFilter {
  return {
    since: isoOrUndefined(query.since),
    until: isoOrUndefined(query.until),
    actor: query.actor?.trim() || undefined,
    action: query.action?.trim() || undefined,
    bucket: query.bucket?.trim() || undefined,
  };
}

function optionalInt(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new InvalidFilterError(value);
  return n;
}

const auditFeatureGuard = requireFeature('audit-export');

export const activityRoutes = new Elysia({ prefix: '/api' })
  .use(authDerive)
  .guard({ beforeHandle: requireAdmin }, (app) =>
    app.get('/activity', ({ query, set }) => {
      try {
        const filter: ActivityFilter = { ...parseFilter(query), before: optionalInt(query.before) };
        return audit.list(filter, optionalInt(query.limit) ?? ACTIVITY_DEFAULT_LIMIT);
      } catch (e) {
        if (!(e instanceof InvalidFilterError)) throw e;
        set.status = 400;
        return { error: 'invalid_filter' };
      }
    }, {
      query: t.Object({
        ...filterQuery,
        limit: t.Optional(t.String({ maxLength: 10 })),
        before: t.Optional(t.String({ maxLength: 20 })),
      }),
    }),
  )
  .guard({ beforeHandle: [requireAdmin, auditFeatureGuard] }, (app) => app
    .get('/activity/export', ({ query, set }) => {
      const format = (query.format ?? 'csv') as ExportFormat;
      if (!EXPORT_FORMATS.includes(format)) { set.status = 400; return { error: 'invalid_format' }; }
      try {
        return exportResponse(format, parseFilter(query));
      } catch (e) {
        if (!(e instanceof InvalidFilterError)) throw e;
        set.status = 400;
        return { error: 'invalid_filter' };
      }
    }, { query: t.Object({ ...filterQuery, format: t.Optional(t.String({ maxLength: 10 })) }) })
    .post('/audit/test-forward', async (ctx) => {
      const { user } = ctx as typeof ctx & { user: AuthUser };
      const s = auditSettings.get();
      if (!s.webhookUrl && !s.syslogHost) { ctx.set.status = 400; return { error: 'no_targets' }; }
      return sendTestEvent(user.username);
    }),
  )
  .guard({ beforeHandle: requireAdmin }, (app) => app
    .get('/audit/settings', () => ({
      ...auditSettings.publicView(),
      licensed: license.has('audit-export'),
      forward: forwardStats(),
    }))
    .put('/audit/settings', (ctx) => {
      const blocked = auditFeatureGuard(ctx);
      if (blocked) return blocked;
      try {
        auditSettings.update(ctx.body);
      } catch (e) {
        if (!(e instanceof AuditSettingsError)) throw e;
        ctx.set.status = 400;
        return { error: e.code };
      }
      return { ...auditSettings.publicView(), licensed: true, forward: forwardStats() };
    }, {
      body: t.Object({
        retentionDays: t.Optional(t.Integer({ minimum: 0, maximum: MAX_RETENTION_DAYS })),
        webhookUrl: t.Optional(t.String({ maxLength: 2048 })),
        webhookSecret: t.Optional(t.String({ maxLength: 512 })),
        webhookBearer: t.Optional(t.String({ maxLength: 4096 })),
        syslogHost: t.Optional(t.String({ maxLength: 255 })),
        syslogPort: t.Optional(t.Integer({ minimum: 1, maximum: 65535 })),
        syslogProtocol: t.Optional(t.Union([t.Literal('udp'), t.Literal('tcp')])),
      }),
    }),
  );
