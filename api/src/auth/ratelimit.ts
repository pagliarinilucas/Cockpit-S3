// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { config } from '../config';

/** Tiny in-memory fixed-window limiter for login attempts (per username+IP). */
const hits = new Map<string, { count: number; resetAt: number }>();

export function tooManyAttempts(key: string): boolean {
  const now = Date.now();
  const e = hits.get(key);
  if (!e || e.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + config.loginWindowMs });
    return false;
  }
  e.count++;
  return e.count > config.loginMaxAttempts;
}

export function resetAttempts(key: string): void {
  hits.delete(key);
}

// occasional cleanup
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k);
}, 60_000).unref?.();
