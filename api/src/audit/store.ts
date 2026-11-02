// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { and, asc, desc, eq, gt, gte, lt, lte, type SQL } from 'drizzle-orm';
import { db, sqlite } from '../db';
import { activity } from '../db/schema';
import { forwardAuditEvent } from './forward';

sqlite.run('CREATE INDEX IF NOT EXISTS idx_activity_at ON activity(at)');

export type ActivityAction = 'upload' | 'download' | 'delete' | 'grant' | 'revoke' | 'key' | 'bucket' | 'share';

export interface ActivityEvent {
  id: number;
  action: ActivityAction;
  actor: string;
  bucket: string;
  target: string;
  at: string;
}

export interface ActivityFilter {
  since?: string;
  until?: string;
  actor?: string;
  action?: string;
  bucket?: string;
  before?: number;
  after?: number;
  maxId?: number;
}

export const ACTIVITY_DEFAULT_LIMIT = 200;
export const ACTIVITY_MAX_LIMIT = 1000;
const EXPORT_BATCH_SIZE = 500;

const columns = {
  id: activity.id,
  action: activity.action,
  actor: activity.actor,
  bucket: activity.bucket,
  target: activity.target,
  at: activity.at,
};

function whereFor(filter: ActivityFilter): SQL | undefined {
  const conditions: SQL[] = [];
  if (filter.since) conditions.push(gte(activity.at, filter.since));
  if (filter.until) conditions.push(lte(activity.at, filter.until));
  if (filter.actor) conditions.push(eq(activity.actor, filter.actor));
  if (filter.action) conditions.push(eq(activity.action, filter.action));
  if (filter.bucket) conditions.push(eq(activity.bucket, filter.bucket));
  if (filter.before !== undefined) conditions.push(lt(activity.id, filter.before));
  if (filter.after !== undefined) conditions.push(gt(activity.id, filter.after));
  if (filter.maxId !== undefined) conditions.push(lte(activity.id, filter.maxId));
  return conditions.length ? and(...conditions) : undefined;
}

export const audit = {
  log(action: ActivityAction, actor: string, bucket: string, target: string): void {
    const event = {
      action,
      actor,
      bucket: bucket || '—',
      target: target || '',
      at: new Date().toISOString(),
    };
    const inserted = db.insert(activity).values(event).returning({ id: activity.id }).get();
    forwardAuditEvent({ id: inserted.id, ...event });
  },
  list(filter: ActivityFilter = {}, limit = ACTIVITY_DEFAULT_LIMIT): ActivityEvent[] {
    const capped = Math.max(1, Math.min(ACTIVITY_MAX_LIMIT, Math.floor(limit) || ACTIVITY_DEFAULT_LIMIT));
    return db.select(columns).from(activity).where(whereFor(filter))
      .orderBy(desc(activity.id)).limit(capped).all() as ActivityEvent[];
  },
  latestId(): number {
    const row = db.select({ id: activity.id }).from(activity).orderBy(desc(activity.id)).limit(1).get();
    return row?.id ?? 0;
  },
  batchAfter(filter: ActivityFilter, afterId: number, size = EXPORT_BATCH_SIZE): ActivityEvent[] {
    return db.select(columns).from(activity).where(whereFor({ ...filter, after: afterId }))
      .orderBy(asc(activity.id)).limit(size).all() as ActivityEvent[];
  },
  *iterate(filter: ActivityFilter = {}, size = EXPORT_BATCH_SIZE): Generator<ActivityEvent[]> {
    const bounded = { ...filter, maxId: filter.maxId ?? audit.latestId() };
    let cursor = 0;
    for (;;) {
      const batch = audit.batchAfter(bounded, cursor, size);
      if (!batch.length) return;
      yield batch;
      cursor = batch[batch.length - 1]!.id;
    }
  },
  pruneBefore(cutoffIso: string): number {
    return sqlite.prepare('DELETE FROM activity WHERE at < ?').run(cutoffIso).changes;
  },
};
