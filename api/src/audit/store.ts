import { desc } from 'drizzle-orm';
import { db } from '../db';
import { activity } from '../db/schema';

export type ActivityAction = 'upload' | 'download' | 'delete' | 'grant' | 'revoke' | 'key' | 'bucket';

export interface ActivityEvent {
  action: ActivityAction;
  actor: string;
  bucket: string;
  target: string;
  at: string;
}

export const audit = {
  log(action: ActivityAction, actor: string, bucket: string, target: string): void {
    db.insert(activity).values({
      action,
      actor,
      bucket: bucket || '—',
      target: target || '',
      at: new Date().toISOString(),
    }).run();
  },
  list(limit = 200): ActivityEvent[] {
    return db.select({
      action: activity.action,
      actor: activity.actor,
      bucket: activity.bucket,
      target: activity.target,
      at: activity.at,
    }).from(activity).orderBy(desc(activity.id)).limit(limit).all() as ActivityEvent[];
  },
};
