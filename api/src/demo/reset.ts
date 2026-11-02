// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { config } from '../config';
import { db, sqlite } from '../db';
import { activity, clusters, connections, grants, groups, shares, userBlocks, userGroups, users } from '../db/schema';
import { hashPassword } from '../auth/passwords';
import { s3 } from '../storage/s3';
import { connectionsStore } from '../connections/store';
import { clustersStore } from '../clusters/store';
import { configureClusterS3 } from '../clusters/routes';
import { garageAdmin } from '../garage/admin';
import { ensureClusterBucketAccess } from '../clusters/access';
import type { ActivityAction } from '../audit/store';
import type { Perm } from '../types';
import {
  DEMO_ACCOUNTS, DEMO_BUCKETS, DEMO_CLUSTER_ID, DEMO_CLUSTER_NAME, DEMO_CONNECTION_ID, DEMO_CONNECTION_NAME,
  assertDemoBucket, demoBucketId, demoSourceId, setDemoSourceId, type DemoBucket,
} from './catalog';
import { buildDemoFiles, type DemoFile } from './fixtures';

export interface DemoStorage {
  ensureBucket(bucket: string): Promise<void>;
  listKeys(bucket: string): Promise<string[]>;
  removeKeys(bucket: string, keys: string[]): Promise<void>;
  put(bucket: string, key: string, data: Uint8Array, contentType: string): Promise<void>;
}

export interface DemoResetSummary {
  users: number;
  groups: number;
  grants: number;
  blocks: number;
  shares: number;
  activity: number;
  objects: number;
  finishedAt: string;
}

const DELETE_BATCH_SIZE = 1000;
const PRESERVED_SETTINGS = ['grants_migrated', 'license_key'];
const FINANCE_GROUP_ID = 'gfinance';
const FINANCE_GROUP_NAME = 'Finance team';
const IP_LOCKED_SHARE_ADDRESS = '203.0.113.42';
const MINUTE_MS = 60_000;

export function s3DemoStorage(): DemoStorage {
  return {
    async ensureBucket(bucket) {
      if (demoSourceId() === DEMO_CLUSTER_ID) {
        await ensureClusterBucketAccess(DEMO_CLUSTER_ID, bucket);
        return;
      }
      const existing = await s3.bucketNames(DEMO_CONNECTION_ID);
      if (!existing.includes(bucket)) await s3.createBucket(DEMO_CONNECTION_ID, bucket);
    },
    async listKeys(bucket) {
      const { items } = await s3.listAllUnder(demoSourceId(), bucket, '');
      return items.map((item) => item.key);
    },
    async removeKeys(bucket, keys) {
      for (let start = 0; start < keys.length; start += DELETE_BATCH_SIZE) {
        await s3.remove(demoSourceId(), bucket, keys.slice(start, start + DELETE_BATCH_SIZE));
      }
    },
    async put(bucket, key, data, contentType) {
      await s3.put(demoSourceId(), bucket, key, data, contentType);
    },
  };
}

export async function emptyDemoBucket(storage: DemoStorage, bucket: string): Promise<number> {
  assertDemoBucket(bucket);
  await storage.ensureBucket(bucket);
  const keys = await storage.listKeys(bucket);
  if (keys.length) await storage.removeKeys(bucket, keys);
  return keys.length;
}

function randomShareToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
}

function isoMinutesAgo(now: number, minutes: number): string {
  return new Date(now - minutes * MINUTE_MS).toISOString();
}

interface GrantSeed { subjectType: 'user' | 'group'; subjectId: string; bucket: DemoBucket; prefix: string; perm: Perm }

const GRANT_SEEDS: GrantSeed[] = [
  { subjectType: 'user', subjectId: 'viewer', bucket: 'acme-contracts', prefix: '', perm: 'view-only' },
  { subjectType: 'user', subjectId: 'viewer', bucket: 'marketing-assets', prefix: '', perm: 'read-only' },
  { subjectType: 'user', subjectId: 'editor', bucket: 'acme-contracts', prefix: '', perm: 'read-write' },
  { subjectType: 'user', subjectId: 'editor', bucket: 'marketing-assets', prefix: '', perm: 'read-write' },
  { subjectType: 'user', subjectId: 'editor', bucket: 'finance-reports', prefix: 'drafts/', perm: 'read-write' },
  { subjectType: 'group', subjectId: FINANCE_GROUP_ID, bucket: 'finance-reports', prefix: '', perm: 'read-only' },
];

const BLOCK_SEEDS: { username: string; bucket: DemoBucket; prefix: string }[] = [
  { username: 'viewer', bucket: 'acme-contracts', prefix: 'legal-hold/' },
];

interface ShareSeed {
  createdBy: string; bucket: DemoBucket; key: string; createdMinutesAgo: number; expiresInMinutes: number;
  revoked: number; lockIp: number; boundIp: string | null;
}

const SHARE_SEEDS: ShareSeed[] = [
  { createdBy: 'editor', bucket: 'marketing-assets', key: 'campaigns/q4-launch/brief.txt', createdMinutesAgo: 360, expiresInMinutes: 1440 - 360, revoked: 0, lockIp: 0, boundIp: null },
  { createdBy: 'editor', bucket: 'acme-contracts', key: 'contracts/2026/nda-globex.pdf', createdMinutesAgo: 4 * 1440 - 30, expiresInMinutes: -(3 * 1440), revoked: 0, lockIp: 0, boundIp: null },
  { createdBy: 'editor', bucket: 'marketing-assets', key: 'social/posts.csv', createdMinutesAgo: 300, expiresInMinutes: 1440 - 300, revoked: 1, lockIp: 0, boundIp: null },
  { createdBy: 'admin', bucket: 'marketing-assets', key: 'press/press-release.pdf', createdMinutesAgo: 1440 - 30, expiresInMinutes: 30, revoked: 0, lockIp: 1, boundIp: IP_LOCKED_SHARE_ADDRESS },
  { createdBy: 'admin', bucket: 'finance-reports', key: '2026/budget.csv', createdMinutesAgo: 90, expiresInMinutes: 1440 - 90, revoked: 0, lockIp: 1, boundIp: null },
];

interface ActivitySeed { minutesAgo: number; action: ActivityAction; actor: string; bucket: DemoBucket | null; target: string }

const ACTIVITY_SEEDS: ActivitySeed[] = [
  { minutesAgo: 9 * 1440, action: 'bucket', actor: 'admin', bucket: null, target: `created connection ${DEMO_CONNECTION_NAME}` },
  { minutesAgo: 9 * 1440 - 5, action: 'bucket', actor: 'admin', bucket: 'acme-contracts', target: 'created bucket' },
  { minutesAgo: 9 * 1440 - 6, action: 'bucket', actor: 'admin', bucket: 'marketing-assets', target: 'created bucket' },
  { minutesAgo: 9 * 1440 - 7, action: 'bucket', actor: 'admin', bucket: 'finance-reports', target: 'created bucket' },
  { minutesAgo: 8 * 1440, action: 'grant', actor: 'admin', bucket: 'acme-contracts', target: 'editor → read-write' },
  { minutesAgo: 8 * 1440 - 1, action: 'grant', actor: 'admin', bucket: 'marketing-assets', target: 'editor → read-write' },
  { minutesAgo: 8 * 1440 - 2, action: 'grant', actor: 'admin', bucket: 'acme-contracts', target: 'viewer → view-only' },
  { minutesAgo: 8 * 1440 - 3, action: 'grant', actor: 'admin', bucket: 'marketing-assets', target: 'viewer → read-only' },
  { minutesAgo: 8 * 1440 - 4, action: 'revoke', actor: 'admin', bucket: 'acme-contracts', target: 'viewer block legal-hold/ ✕' },
  { minutesAgo: 8 * 1440 - 10, action: 'grant', actor: 'admin', bucket: 'finance-reports', target: `group ${FINANCE_GROUP_ID} → read-only` },
  { minutesAgo: 8 * 1440 - 11, action: 'grant', actor: 'admin', bucket: null, target: `editor group ${FINANCE_GROUP_ID} +` },
  { minutesAgo: 8 * 1440 - 12, action: 'grant', actor: 'admin', bucket: 'finance-reports', target: 'editor /drafts/ → read-write' },
  { minutesAgo: 8 * 1440 - 13, action: 'grant', actor: 'admin', bucket: null, target: 'editor share ✓' },
  { minutesAgo: 7 * 1440, action: 'upload', actor: 'editor', bucket: 'acme-contracts', target: 'contracts/2026/master-services-agreement.pdf' },
  { minutesAgo: 7 * 1440 - 2, action: 'upload', actor: 'editor', bucket: 'acme-contracts', target: 'contracts/2026/nda-globex.pdf' },
  { minutesAgo: 7 * 1440 - 3, action: 'upload', actor: 'editor', bucket: 'acme-contracts', target: 'contracts/vendors.csv' },
  { minutesAgo: 6 * 1440, action: 'upload', actor: 'admin', bucket: 'acme-contracts', target: 'legal-hold/litigation-notes.txt' },
  { minutesAgo: 5 * 1440, action: 'upload', actor: 'editor', bucket: 'marketing-assets', target: 'brand/logo.png' },
  { minutesAgo: 5 * 1440 - 20, action: 'upload', actor: 'editor', bucket: 'marketing-assets', target: 'campaigns/q4-launch/banner.png' },
  { minutesAgo: 5 * 1440 - 21, action: 'upload', actor: 'editor', bucket: 'marketing-assets', target: 'campaigns/q4-launch/brief.txt' },
  { minutesAgo: 4 * 1440, action: 'download', actor: 'viewer', bucket: 'marketing-assets', target: 'brand/logo.png' },
  { minutesAgo: 4 * 1440 - 30, action: 'share', actor: 'editor', bucket: 'acme-contracts', target: 'contracts/2026/nda-globex.pdf' },
  { minutesAgo: 3 * 1440, action: 'upload', actor: 'admin', bucket: 'finance-reports', target: '2026/q3-revenue.xlsx' },
  { minutesAgo: 3 * 1440 - 1, action: 'upload', actor: 'admin', bucket: 'finance-reports', target: '2026/budget.csv' },
  { minutesAgo: 3 * 1440 - 40, action: 'download', actor: 'editor', bucket: 'finance-reports', target: '2026/q3-revenue.xlsx' },
  { minutesAgo: 2 * 1440, action: 'upload', actor: 'editor', bucket: 'finance-reports', target: 'drafts/q4-forecast.xlsx' },
  { minutesAgo: 2 * 1440 - 3, action: 'upload', actor: 'editor', bucket: 'finance-reports', target: 'drafts/notes.txt' },
  { minutesAgo: 2 * 1440 - 60, action: 'delete', actor: 'editor', bucket: 'finance-reports', target: 'drafts/q4-forecast-old.xlsx' },
  { minutesAgo: 1440, action: 'upload', actor: 'editor', bucket: 'marketing-assets', target: 'press/press-release.pdf' },
  { minutesAgo: 1440 - 5, action: 'upload', actor: 'editor', bucket: 'marketing-assets', target: 'social/posts.csv' },
  { minutesAgo: 1440 - 30, action: 'share', actor: 'admin', bucket: 'marketing-assets', target: 'press/press-release.pdf' },
  { minutesAgo: 600, action: 'download', actor: 'viewer', bucket: 'marketing-assets', target: 'press/press-release.pdf' },
  { minutesAgo: 360, action: 'share', actor: 'editor', bucket: 'marketing-assets', target: 'campaigns/q4-launch/brief.txt' },
  { minutesAgo: 240, action: 'share', actor: 'editor', bucket: 'marketing-assets', target: 'revoked link' },
  { minutesAgo: 120, action: 'key', actor: 'admin', bucket: null, target: 'rotated access key demo-key' },
  { minutesAgo: 45, action: 'download', actor: 'editor', bucket: 'acme-contracts', target: 'contracts/2026/master-services-agreement.pdf' },
  { minutesAgo: 20, action: 'grant', actor: 'admin', bucket: 'marketing-assets', target: 'alias: Marketing' },
];

function seedDatabase(passwordHashes: Map<string, string>, now: number): Omit<DemoResetSummary, 'objects' | 'finishedAt'> {
  const nowIso = new Date(now).toISOString();
  const createdAt = isoMinutesAgo(now, 10 * 1440);
  const keepCluster = !!(config.demo.garageAdmin.endpoint && config.demo.garageAdmin.token);

  sqlite.transaction(() => {
    for (const table of [
      'sessions', 'user_blocks', 'user_groups', 'grants', 'shares', 'groups',
      'sheet_updates', 'sheet_docs', 'objects', 'bucket_crypto', 'bucket_aliases', 'activity', 'users', 'connections',
    ]) {
      sqlite.run(`DELETE FROM ${table}`);
    }
    if (keepCluster) sqlite.prepare('DELETE FROM clusters WHERE id <> ?').run(DEMO_CLUSTER_ID);
    else sqlite.run('DELETE FROM clusters');
    sqlite.prepare(`DELETE FROM settings WHERE key NOT IN (${PRESERVED_SETTINGS.map(() => '?').join(', ')})`).run(...PRESERVED_SETTINGS);
    sqlite.run("DELETE FROM sqlite_sequence WHERE name = 'activity'");

    if (demoSourceId() === DEMO_CONNECTION_ID) db.insert(connections).values({
      id: DEMO_CONNECTION_ID,
      name: DEMO_CONNECTION_NAME,
      endpoint: config.demo.s3.endpoint,
      region: config.demo.s3.region || 'garage',
      accessKey: config.demo.s3.accessKey,
      secretKey: config.demo.s3.secretKey,
      buckets: JSON.stringify(DEMO_BUCKETS),
      createdAt,
    }).run();

    for (const account of DEMO_ACCOUNTS) {
      db.insert(users).values({
        username: account.username,
        passwordHash: passwordHashes.get(account.username)!,
        role: account.role,
        tokenVersion: 1,
        grants: '{}',
        active: 1,
        canShare: account.username === 'editor' ? 1 : 0,
        createdAt,
      }).run();
    }

    db.insert(groups).values({ id: FINANCE_GROUP_ID, name: FINANCE_GROUP_NAME, createdAt }).run();
    db.insert(userGroups).values({ username: 'editor', groupId: FINANCE_GROUP_ID }).run();

    for (const seed of GRANT_SEEDS) {
      db.insert(grants).values({
        subjectType: seed.subjectType, subjectId: seed.subjectId,
        bucketId: demoBucketId(seed.bucket), prefix: seed.prefix, perm: seed.perm,
      }).run();
    }
    for (const seed of BLOCK_SEEDS) {
      db.insert(userBlocks).values({ username: seed.username, bucketId: demoBucketId(seed.bucket), prefix: seed.prefix }).run();
    }

    for (const seed of SHARE_SEEDS) {
      db.insert(shares).values({
        token: randomShareToken(),
        bucketId: demoBucketId(seed.bucket),
        key: seed.key,
        createdBy: seed.createdBy,
        createdAt: isoMinutesAgo(now, seed.createdMinutesAgo),
        expiresAt: isoMinutesAgo(now, -seed.expiresInMinutes),
        revoked: seed.revoked,
        lockIp: seed.lockIp,
        boundIp: seed.boundIp,
      }).run();
    }

    db.insert(activity).values(ACTIVITY_SEEDS.map((seed) => ({
      action: seed.action,
      actor: seed.actor,
      bucket: seed.bucket ? demoBucketId(seed.bucket) : '—',
      target: seed.target,
      at: isoMinutesAgo(now, seed.minutesAgo),
    }))).run();
    db.insert(activity).values({ action: 'key', actor: 'system', bucket: '—', target: 'demo data reset', at: nowIso }).run();
  })();

  return {
    users: DEMO_ACCOUNTS.length,
    groups: 1,
    grants: GRANT_SEEDS.length,
    blocks: BLOCK_SEEDS.length,
    shares: SHARE_SEEDS.length,
    activity: ACTIVITY_SEEDS.length + 1,
  };
}

async function ensureDemoCluster(): Promise<void> {
  const { endpoint, token } = config.demo.garageAdmin;
  if (!endpoint || !token) return;
  const values = {
    name: DEMO_CLUSTER_NAME,
    adminEndpoint: endpoint,
    adminToken: token,
    s3Endpoint: config.demo.s3.endpoint,
    region: config.demo.s3.region || 'garage',
  };
  if (clustersStore.exists(DEMO_CLUSTER_ID)) {
    clustersStore.update(DEMO_CLUSTER_ID, values);
  } else {
    db.insert(clusters).values({ id: DEMO_CLUSTER_ID, ...values, createdAt: new Date().toISOString() }).run();
  }
  if (clustersStore.getFull(DEMO_CLUSTER_ID)?.internalKeyId) return;
  try {
    const key = await garageAdmin({ endpoint, token }).createKey(`cockpit-${DEMO_CLUSTER_NAME}`);
    clustersStore.setInternalKey(DEMO_CLUSTER_ID, key.accessKeyId, key.secretAccessKey);
  } catch (error) {
    clustersStore.remove(DEMO_CLUSTER_ID);
    console.warn('[demo] could not register the Garage cluster:', String((error as Error)?.message ?? error));
  }
}

function reconfigureStorageClients(): void {
  s3.configureAll(connectionsStore.listFull());
  for (const cluster of clustersStore.listFull()) configureClusterS3(cluster);
}

async function refillBuckets(storage: DemoStorage, files: DemoFile[]): Promise<number> {
  for (const bucket of DEMO_BUCKETS) await emptyDemoBucket(storage, bucket);
  for (const file of files) {
    assertDemoBucket(file.bucket);
    await storage.put(file.bucket, file.key, file.data, file.contentType);
  }
  return files.length;
}

export async function resetDemoData(storage: DemoStorage, options: { manageClients?: boolean } = {}): Promise<DemoResetSummary> {
  if (!config.demo.enabled) throw new Error('demo_mode_disabled');
  const manageClients = options.manageClients ?? true;
  const passwordHashes = new Map<string, string>();
  for (const account of DEMO_ACCOUNTS) passwordHashes.set(account.username, await hashPassword(account.password));
  const files = await buildDemoFiles();

  if (manageClients) await ensureDemoCluster();
  setDemoSourceId(clustersStore.getFull(DEMO_CLUSTER_ID)?.internalKeyId ? DEMO_CLUSTER_ID : DEMO_CONNECTION_ID);
  const counts = seedDatabase(passwordHashes, Date.now());
  if (manageClients) reconfigureStorageClients();
  const objects = await refillBuckets(storage, files);
  return { ...counts, objects, finishedAt: new Date().toISOString() };
}

let inFlightReset: Promise<DemoResetSummary> | null = null;

export function runDemoReset(storage: DemoStorage = s3DemoStorage(), options: { manageClients?: boolean } = {}): Promise<DemoResetSummary> {
  if (!config.demo.enabled) return Promise.reject(new Error('demo_mode_disabled'));
  if (inFlightReset) return inFlightReset;
  inFlightReset = resetDemoData(storage, options).finally(() => { inFlightReset = null; });
  return inFlightReset;
}

const RETRY_AFTER_FAILURE_MS = 30_000;
let nextResetAt: Date | null = null;
let resetTimer: ReturnType<typeof setTimeout> | null = null;

export function demoNextResetAt(): Date | null {
  return nextResetAt;
}

function scheduleNextReset(delayMs: number): void {
  if (resetTimer) clearTimeout(resetTimer);
  nextResetAt = new Date(Date.now() + delayMs);
  resetTimer = setTimeout(() => { void performScheduledReset(); }, delayMs);
  resetTimer.unref?.();
}

async function performScheduledReset(): Promise<void> {
  const intervalMs = config.demo.resetMinutes * MINUTE_MS;
  try {
    const summary = await runDemoReset();
    console.log(`[demo] data reset: ${summary.users} users, ${summary.objects} objects, ${summary.shares} share links`);
    scheduleNextReset(intervalMs);
  } catch (error) {
    console.error('[demo] reset failed, retrying soon:', String((error as Error)?.message ?? error));
    scheduleNextReset(Math.min(RETRY_AFTER_FAILURE_MS, intervalMs));
  }
}

export async function startDemoMode(): Promise<void> {
  if (!config.demo.enabled) return;
  if (!config.demo.s3.endpoint || !config.demo.s3.accessKey || !config.demo.s3.secretKey) {
    console.error('[demo] DEMO_MODE=true requires DEMO_S3_ENDPOINT, DEMO_S3_ACCESS_KEY and DEMO_S3_SECRET_KEY');
  }
  console.log(`[demo] public demo mode on: data resets every ${config.demo.resetMinutes} min`);
  await performScheduledReset();
}
