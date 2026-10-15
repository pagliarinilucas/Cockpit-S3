// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { settings } from '../db/schema';

export type SyslogProtocol = 'udp' | 'tcp';

export interface AuditSettings {
  retentionDays: number;
  webhookUrl: string;
  webhookSecret: string;
  webhookBearer: string;
  syslogHost: string;
  syslogPort: number;
  syslogProtocol: SyslogProtocol;
}

export interface PublicAuditSettings {
  retentionDays: number;
  webhookUrl: string;
  webhookSecretSet: boolean;
  webhookBearerSet: boolean;
  syslogHost: string;
  syslogPort: number;
  syslogProtocol: SyslogProtocol;
}

export interface AuditSettingsPatch {
  retentionDays?: number;
  webhookUrl?: string;
  webhookSecret?: string;
  webhookBearer?: string;
  syslogHost?: string;
  syslogPort?: number;
  syslogProtocol?: SyslogProtocol;
}

export const MAX_RETENTION_DAYS = 36500;
const SETTINGS_KEY = 'audit_settings';

export const DEFAULT_AUDIT_SETTINGS: AuditSettings = {
  retentionDays: 0,
  webhookUrl: '',
  webhookSecret: '',
  webhookBearer: '',
  syslogHost: '',
  syslogPort: 514,
  syslogProtocol: 'udp',
};

let cached: AuditSettings | null = null;

export class AuditSettingsError extends Error {
  constructor(public code: string) { super(code); }
}

function readStored(): AuditSettings {
  const row = db.select({ value: settings.value }).from(settings).where(eq(settings.key, SETTINGS_KEY)).get();
  if (!row) return { ...DEFAULT_AUDIT_SETTINGS };
  try {
    return { ...DEFAULT_AUDIT_SETTINGS, ...(JSON.parse(row.value) as Partial<AuditSettings>) };
  } catch {
    return { ...DEFAULT_AUDIT_SETTINGS };
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function validated(next: AuditSettings): AuditSettings {
  if (!Number.isInteger(next.retentionDays) || next.retentionDays < 0 || next.retentionDays > MAX_RETENTION_DAYS) {
    throw new AuditSettingsError('invalid_retention');
  }
  if (next.webhookUrl && !isHttpUrl(next.webhookUrl)) throw new AuditSettingsError('invalid_webhook_url');
  if (next.syslogHost && !/^[A-Za-z0-9.:\-_[\]]{1,255}$/.test(next.syslogHost)) throw new AuditSettingsError('invalid_syslog_host');
  if (!Number.isInteger(next.syslogPort) || next.syslogPort < 1 || next.syslogPort > 65535) {
    throw new AuditSettingsError('invalid_syslog_port');
  }
  if (next.syslogProtocol !== 'udp' && next.syslogProtocol !== 'tcp') throw new AuditSettingsError('invalid_syslog_protocol');
  return next;
}

export const auditSettings = {
  get(): AuditSettings {
    if (!cached) cached = readStored();
    return cached;
  },
  publicView(): PublicAuditSettings {
    const s = auditSettings.get();
    return {
      retentionDays: s.retentionDays,
      webhookUrl: s.webhookUrl,
      webhookSecretSet: !!s.webhookSecret,
      webhookBearerSet: !!s.webhookBearer,
      syslogHost: s.syslogHost,
      syslogPort: s.syslogPort,
      syslogProtocol: s.syslogProtocol,
    };
  },
  update(patch: AuditSettingsPatch): AuditSettings {
    const current = auditSettings.get();
    const next = validated({
      retentionDays: patch.retentionDays ?? current.retentionDays,
      webhookUrl: (patch.webhookUrl ?? current.webhookUrl).trim(),
      webhookSecret: patch.webhookSecret ?? current.webhookSecret,
      webhookBearer: patch.webhookBearer ?? current.webhookBearer,
      syslogHost: (patch.syslogHost ?? current.syslogHost).trim(),
      syslogPort: patch.syslogPort ?? current.syslogPort,
      syslogProtocol: patch.syslogProtocol ?? current.syslogProtocol,
    });
    const value = JSON.stringify(next);
    db.insert(settings).values({ key: SETTINGS_KEY, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run();
    cached = next;
    return next;
  },
  resetCacheForTests(): void {
    cached = null;
  },
};
