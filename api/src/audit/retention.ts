// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { license } from '../license/service';
import { auditSettings } from './settings';
import { audit } from './store';

const RETENTION_INTERVAL_MS = 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 30 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let firstRunHandle: ReturnType<typeof setTimeout> | null = null;

export function pruneAuditLog(now = new Date()): number {
  if (!license.has('audit-export')) return 0;
  const days = auditSettings.get().retentionDays;
  if (!days) return 0;
  const cutoff = new Date(now.getTime() - days * DAY_MS).toISOString();
  return audit.pruneBefore(cutoff);
}

function runRetention(): void {
  try {
    const removed = pruneAuditLog();
    if (removed) console.log(`[audit] retenção removeu ${removed} evento(s) antigo(s)`);
  } catch (e) {
    console.warn('[audit] falha na retenção:', e);
  }
}

export function startAuditRetention(): void {
  if (intervalHandle) return;
  firstRunHandle = setTimeout(runRetention, FIRST_RUN_DELAY_MS);
  firstRunHandle.unref();
  intervalHandle = setInterval(runRetention, RETENTION_INTERVAL_MS);
  intervalHandle.unref();
}

export function stopAuditRetention(): void {
  if (firstRunHandle) clearTimeout(firstRunHandle);
  if (intervalHandle) clearInterval(intervalHandle);
  firstRunHandle = null;
  intervalHandle = null;
}
