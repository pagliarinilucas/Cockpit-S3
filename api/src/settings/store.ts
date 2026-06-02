import { db } from '../db';

export interface GarageConfig {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  buckets: string[];
}

const KEY = 'garage';

export const settingsStore = {
  getGarage(): GarageConfig | null {
    const row = db.query('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | null;
    if (!row) return null;
    try { return JSON.parse(row.value) as GarageConfig; } catch { return null; }
  },
  setGarage(c: GarageConfig): void {
    db.query('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(KEY, JSON.stringify(c));
  },
};
