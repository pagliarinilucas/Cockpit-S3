// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini

export interface Snapshot {
  key: string;
  at: number;
}

export interface RetentionPolicy {
  recentMs: number;
  hourlyForMs: number;
  dailyForMs: number;
}

export function defaultPolicy(): RetentionPolicy {
  return {
    recentMs: 2 * 3_600_000,
    hourlyForMs: 24 * 3_600_000,
    dailyForMs: 7 * 24 * 3_600_000,
  };
}

export function planRetention(
  snaps: Snapshot[],
  now: number,
  policy: RetentionPolicy = defaultPolicy(),
): { keep: Snapshot[]; remove: Snapshot[] } {
  if (snaps.length === 0) {
    return { keep: [], remove: [] };
  }

  const sorted = [...snaps].sort((a, b) => b.at - a.at);
  const newest = sorted[0] as Snapshot;

  const keepSet = new Set<Snapshot>([newest]);
  const hourlyBuckets = new Map<number, Snapshot>();
  const dailyBuckets = new Map<number, Snapshot>();
  hourlyBuckets.set(Math.floor(newest.at / 3_600_000), newest);
  dailyBuckets.set(Math.floor(newest.at / 86_400_000), newest);

  for (const s of sorted) {
    if (s === newest) continue;

    const age = now - s.at;

    if (age <= policy.recentMs) {
      keepSet.add(s);
      continue;
    }

    if (age <= policy.hourlyForMs) {
      const bucket = Math.floor(s.at / 3_600_000);
      const current = hourlyBuckets.get(bucket);
      if (!current || s.at > current.at) {
        hourlyBuckets.set(bucket, s);
      }
      continue;
    }

    if (age <= policy.dailyForMs) {
      const bucket = Math.floor(s.at / 86_400_000);
      const current = dailyBuckets.get(bucket);
      if (!current || s.at > current.at) {
        dailyBuckets.set(bucket, s);
      }
      continue;
    }
  }

  for (const s of hourlyBuckets.values()) keepSet.add(s);
  for (const s of dailyBuckets.values()) keepSet.add(s);

  const keep: Snapshot[] = [];
  const remove: Snapshot[] = [];

  for (const s of sorted) {
    if (keepSet.has(s)) {
      keep.push(s);
    } else {
      remove.push(s);
    }
  }

  return { keep, remove };
}
