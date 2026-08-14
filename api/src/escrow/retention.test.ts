// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini

import { describe, expect, it } from "bun:test";
import { defaultPolicy, planRetention, type Snapshot } from "./retention";

const NOW = 1_000_000_000_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function snap(key: string, ageMs: number): Snapshot {
  return { key, at: NOW - ageMs };
}

function inHourBucket(bucketsAgo: number, offsetMs: number): number {
  const bucket = Math.floor(NOW / HOUR) - bucketsAgo;
  return bucket * HOUR + offsetMs;
}

function inDayBucket(bucketsAgo: number, offsetMs: number): number {
  const bucket = Math.floor(NOW / DAY) - bucketsAgo;
  return bucket * DAY + offsetMs;
}

describe("planRetention", () => {
  it("nunca remove o snapshot mais novo, mesmo se muito antigo", () => {
    const snaps: Snapshot[] = [snap("only", 30 * DAY)];
    const { keep, remove } = planRetention(snaps, NOW);
    expect(keep.map((s) => s.key)).toEqual(["only"]);
    expect(remove).toEqual([]);
  });

  it("mantém todos os snapshots dentro da janela recente", () => {
    const snaps: Snapshot[] = [
      snap("a", 0),
      snap("b", 30 * 60_000),
      snap("c", 90 * 60_000),
    ];
    const { keep, remove } = planRetention(snaps, NOW);
    expect(keep.map((s) => s.key).sort()).toEqual(["a", "b", "c"]);
    expect(remove).toEqual([]);
  });

  it("colapsa múltiplos snapshots da mesma hora (entre recentMs e hourlyForMs) para 1", () => {
    const snaps: Snapshot[] = [
      snap("newest", 0),
      { key: "h1-older", at: inHourBucket(5, 5 * 60_000) },
      { key: "h1-newer", at: inHourBucket(5, 55 * 60_000) },
      { key: "h2-only", at: inHourBucket(8, 5 * 60_000) },
    ];
    const { keep, remove } = planRetention(snaps, NOW);
    const keptKeys = keep.map((s) => s.key);
    expect(keptKeys).toContain("newest");
    expect(keptKeys).toContain("h1-newer");
    expect(keptKeys).toContain("h2-only");
    expect(keptKeys).not.toContain("h1-older");
    expect(remove.map((s) => s.key)).toEqual(["h1-older"]);
  });

  it("colapsa múltiplos snapshots do mesmo dia (entre hourlyForMs e dailyForMs) para 1", () => {
    const snaps: Snapshot[] = [
      snap("newest", 0),
      { key: "d3-older", at: inDayBucket(3, 5 * HOUR) },
      { key: "d3-newer", at: inDayBucket(3, 20 * HOUR) },
      { key: "d4-only", at: inDayBucket(4, 5 * HOUR) },
    ];
    const { keep, remove } = planRetention(snaps, NOW);
    const keptKeys = keep.map((s) => s.key);
    expect(keptKeys).toContain("newest");
    expect(keptKeys).toContain("d3-newer");
    expect(keptKeys).toContain("d4-only");
    expect(keptKeys).not.toContain("d3-older");
    expect(remove.map((s) => s.key)).toEqual(["d3-older"]);
  });

  it("remove snapshots além de dailyForMs", () => {
    const snaps: Snapshot[] = [
      snap("newest", 0),
      snap("very-old", 10 * DAY),
      snap("even-older", 20 * DAY),
    ];
    const { keep, remove } = planRetention(snaps, NOW);
    expect(keep.map((s) => s.key)).toEqual(["newest"]);
    expect(remove.map((s) => s.key).sort()).toEqual(["even-older", "very-old"]);
  });

  it("keep e remove particionam a entrada por completo", () => {
    const snaps: Snapshot[] = [
      snap("newest", 0),
      snap("recent", 60 * 60_000),
      snap("hourly-a", 5 * HOUR),
      snap("hourly-b", 5 * HOUR + 30 * 60_000),
      snap("daily-a", 3 * DAY),
      snap("daily-b", 3 * DAY + 5 * HOUR),
      snap("old", 30 * DAY),
    ];
    const { keep, remove } = planRetention(snaps, NOW);
    expect(keep.length + remove.length).toBe(snaps.length);
    const allKeys = new Set([...keep, ...remove].map((s) => s.key));
    expect(allKeys.size).toBe(snaps.length);
  });

  it("vizinho no mesmo bucket do mais novo (fora da janela recente) é removido", () => {
    const snaps = [
      { key: "newest", at: inHourBucket(5, 4 * 60_000) },
      { key: "sibling-same-hour", at: inHourBucket(5, 1 * 60_000) },
    ];
    const { keep, remove } = planRetention(snaps, NOW);
    expect(keep.map((s) => s.key)).toEqual(["newest"]);
    expect(remove.map((s) => s.key)).toEqual(["sibling-same-hour"]);
  });

  it("defaultPolicy retorna os limiares esperados", () => {
    const policy = defaultPolicy();
    expect(policy).toEqual({
      recentMs: 2 * 3_600_000,
      hourlyForMs: 24 * 3_600_000,
      dailyForMs: 7 * 24 * 3_600_000,
    });
  });
});
