// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import type { Role } from '../types';

export const DEMO_CONNECTION_ID = 'cdemo';
export const DEMO_CLUSTER_ID = 'kdemo';
export const DEMO_CONNECTION_NAME = 'Demo Garage';
export const DEMO_CLUSTER_NAME = 'demo';

export const DEMO_BUCKETS = ['acme-contracts', 'marketing-assets', 'finance-reports'] as const;
export type DemoBucket = (typeof DEMO_BUCKETS)[number];

export const MAX_DEMO_SHARE_TTL_SECONDS = 86_400;

export interface DemoAccount {
  username: string;
  password: string;
  role: Role;
  description: string;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    username: 'admin',
    password: 'demo',
    role: 'admin',
    description: 'Full access: users, groups, permission matrix, activity log and every bucket.',
  },
  {
    username: 'editor',
    password: 'demo',
    role: 'user',
    description: 'Read-write on contracts and marketing, read-only on finance (via group) with a writable drafts/ folder. Can create share links.',
  },
  {
    username: 'viewer',
    password: 'demo',
    role: 'user',
    description: 'View-only on contracts (legal-hold/ hidden), read-only on marketing, no access to finance.',
  },
];

export const PROTECTED_DEMO_USERNAMES: ReadonlySet<string> = new Set(DEMO_ACCOUNTS.map((account) => account.username));

export function demoRoleOf(username: string): Role | null {
  return DEMO_ACCOUNTS.find((account) => account.username === username)?.role ?? null;
}

let activeDemoSourceId: string = DEMO_CONNECTION_ID;

export function demoSourceId(): string {
  return activeDemoSourceId;
}

export function setDemoSourceId(sourceId: typeof DEMO_CONNECTION_ID | typeof DEMO_CLUSTER_ID): void {
  activeDemoSourceId = sourceId;
}

export function demoBucketId(bucket: DemoBucket): string {
  return `${activeDemoSourceId}:${bucket}`;
}

export function isDemoBucket(name: string): name is DemoBucket {
  return (DEMO_BUCKETS as readonly string[]).includes(name);
}

export function assertDemoBucket(name: string): asserts name is DemoBucket {
  if (!isDemoBucket(name)) throw new Error(`refusing to touch non-demo bucket: ${name}`);
}
