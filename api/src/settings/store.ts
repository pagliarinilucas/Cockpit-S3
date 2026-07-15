// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { settings } from '../db/schema';

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
    const row = db.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY)).get();
    if (!row) return null;
    try { return JSON.parse(row.value) as GarageConfig; } catch { return null; }
  },
  setGarage(c: GarageConfig): void {
    const value = JSON.stringify(c);
    db.insert(settings).values({ key: KEY, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run();
  },
};
