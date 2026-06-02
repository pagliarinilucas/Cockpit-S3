import { db } from '../db';

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
    db.query('INSERT INTO activity (action, actor, bucket, target, at) VALUES (?, ?, ?, ?, ?)')
      .run(action, actor, bucket || '—', target || '', new Date().toISOString());
  },
  list(limit = 200): ActivityEvent[] {
    return db.query('SELECT action, actor, bucket, target, at FROM activity ORDER BY id DESC LIMIT ?')
      .all(limit) as ActivityEvent[];
  },
};
