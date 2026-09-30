import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { parseTrophyTitleItem, mergeTrophyDefinitionsAndEarned } from "../collector/src/parser.js";
import { computeSnapshotDiff } from "../collector/src/diff.js";
import { validateAndSaveSnapshot, loadCurrentSnapshot } from "../collector/src/storage.js";
import type { CanonicalSnapshot } from "../schemas/index.js";

describe("PSN Collector Parser", () => {
  it("correctly parses raw trophy title item into GameTitle", () => {
    const raw = {
      npCommunicationId: "NPWR12345_00",
      trophyTitleName: "SILENT HILL f",
      trophyTitlePlatform: "PS5",
      trophyTitleIconUrl: "https://image.api.playstation.com/icon.png",
      earnedTrophies: {
        platinum: 0,
        gold: 1,
        silver: 5,
        bronze: 20
      },
      definedTrophies: {
        platinum: 1,
        gold: 3,
        silver: 10,
        bronze: 30
      },
      progress: 59,
      lastUpdatedDateTime: "2026-09-30T00:00:00Z"
    };

    const parsed = parseTrophyTitleItem(raw);
    expect(parsed.id).toBe("NPWR12345_00");
    expect(parsed.name).toBe("SILENT HILL f");
    expect(parsed.platform).toEqual(["PS5"]);
    expect(parsed.progress.earned).toBe(26);
    expect(parsed.progress.total).toBe(44);
    expect(parsed.platinumEarned).toBe(false);
  });

  it("merges definitions and earned status properly", () => {
    const definitions = [
      {
        trophyId: 0,
        trophyName: "Master of F",
        trophyDetail: "Obtain all trophies",
        trophyType: "platinum",
        trophyHidden: true,
        trophyEarnedRate: "0.1",
        trophyRare: 0
      },
      {
        trophyId: 1,
        trophyName: "First Step",
        trophyDetail: "Complete Chapter 1",
        trophyType: "bronze",
        trophyHidden: false,
        trophyEarnedRate: "85.4",
        trophyRare: 3
      }
    ];

    const earned = [
      {
        trophyId: 1,
        earned: true,
        earnedDateTime: "2026-09-29T10:00:00Z"
      }
    ];

    const merged = mergeTrophyDefinitionsAndEarned(definitions, earned);
    expect(merged.length).toBe(2);
    expect(merged[0].id).toBe(0);
    expect(merged[0].earned).toBe(false);
    expect(merged[0].grade).toBe("platinum");
    expect(merged[0].hidden).toBe(true);

    expect(merged[1].id).toBe(1);
    expect(merged[1].earned).toBe(true);
    expect(merged[1].earnedAt).toBe("2026-09-29T10:00:00Z");
  });
});

describe("Snapshot Diff and Storage", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "psn-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const baseSnapshot: CanonicalSnapshot = {
    metadata: {
      schemaVersion: 1,
      generatedAt: "2026-09-30T00:00:00Z",
      lastSuccessfulSync: "2026-09-30T00:00:00Z",
      source: "playstation-network"
    },
    profile: {
      onlineId: "eggu_",
      trophyLevel: 100,
      progress: 50,
      trophies: {
        total: 10,
        platinum: 0,
        gold: 2,
        silver: 3,
        bronze: 5
      },
      games: {
        total: 1,
        completed: 0
      },
      lastSuccessfulSync: "2026-09-30T00:00:00Z"
    },
    games: [
      {
        id: "NPWR111_00",
        name: "Game A",
        platform: ["PS5"],
        progress: { earned: 10, total: 20, percentage: 50 },
        platinumEarned: false,
        trophySummary: {
          platinum: { earned: 0, total: 1 },
          gold: { earned: 2, total: 3 },
          silver: { earned: 3, total: 6 },
          bronze: { earned: 5, total: 10 }
        },
        trophies: [
          {
            id: 1,
            name: "Trophy 1",
            grade: "bronze",
            hidden: false,
            earned: true,
            earnedAt: "2026-09-29T00:00:00Z",
            groupId: "default"
          },
          {
            id: 2,
            name: "Trophy 2",
            grade: "bronze",
            hidden: false,
            earned: false,
            groupId: "default"
          }
        ]
      }
    ]
  };

  it("calculates diff accurately between two snapshots", () => {
    const updatedSnapshot: CanonicalSnapshot = JSON.parse(JSON.stringify(baseSnapshot));
    updatedSnapshot.metadata.lastSuccessfulSync = "2026-09-30T06:00:00Z";
    updatedSnapshot.profile.trophies.total = 11;
    updatedSnapshot.profile.trophies.bronze = 6;
    updatedSnapshot.games[0].progress.earned = 11;
    updatedSnapshot.games[0].progress.percentage = 55;
    updatedSnapshot.games[0].trophies[1].earned = true;
    updatedSnapshot.games[0].trophies[1].earnedAt = "2026-09-30T04:00:00Z";

    const diff = computeSnapshotDiff(baseSnapshot, updatedSnapshot);
    expect(diff.summaryDelta.total).toBe(1);
    expect(diff.summaryDelta.bronze).toBe(1);
    expect(diff.newTrophies.length).toBe(1);
    expect(diff.newTrophies[0].trophy.name).toBe("Trophy 2");
    expect(diff.changedGames.length).toBe(1);
    expect(diff.changedGames[0].current.earned).toBe(11);
  });

  it("validates and atomically saves snapshot to storage", async () => {
    const res = await validateAndSaveSnapshot(tempDir, baseSnapshot);
    expect(res.snapshotPath).toBeDefined();

    const loaded = await loadCurrentSnapshot(tempDir);
    expect(loaded).not.toBeNull();
    expect(loaded?.profile.onlineId).toBe("eggu_");
    expect(loaded?.games[0].name).toBe("Game A");
  });
});
