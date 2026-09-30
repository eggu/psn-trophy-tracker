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
            description: "",
            grade: "bronze",
            hidden: false,
            earned: true,
            earnedAt: "2026-09-29T00:00:00Z",
            groupId: "default"
          },
          {
            id: 2,
            name: "Trophy 2",
            description: "",
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

describe('Legacy PS4 regression (live PSN fixture)', () => {
  it('preserves Code Veronica definitions, earned counts, grades and timestamps', async () => {
    const { default: fixture } = await import('./fixtures/veronica-ps4.json');
    const { getNpServiceName } = await import('../collector/src/parser.js');
    expect(getNpServiceName(fixture.title)).toBe('trophy');
    expect(getNpServiceName({ trophyTitlePlatform: 'PS3,PSVITA' })).toBe('trophy');
    expect(getNpServiceName({ trophyTitlePlatform: 'PS5' })).toBe('trophy2');
    expect(getNpServiceName({ npServiceName: 'trophy', trophyTitlePlatform: 'PS5' })).toBe('trophy');
    const game = parseTrophyTitleItem(fixture.title);
    game.trophies = mergeTrophyDefinitionsAndEarned(fixture.definitions.trophies, fixture.earned.trophies);
    expect(game.progress).toEqual({ earned: 9, total: 30, percentage: 18 });
    expect(game.trophies).toHaveLength(30);
    expect(game.trophies.filter(t => t.earned)).toHaveLength(9);
    for (const grade of ['platinum', 'gold', 'silver', 'bronze'] as const) {
      const trophies = game.trophies.filter(t => t.grade === grade);
      expect(trophies.length).toBe(game.trophySummary[grade].total);
      expect(trophies.filter(t => t.earned).length).toBe(game.trophySummary[grade].earned);
    }
    for (const raw of fixture.earned.trophies) {
      expect(game.trophies.find(t => t.id === raw.trophyId)?.earnedAt).toBe(raw.earnedDateTime ?? null);
    }
    expect(game.trophies.filter(t => t.earned).map(t => t.earnedAt).sort().at(-1)).toBe('2026-09-29T15:09:01Z');
  });

  it('rejects missing details before overwriting a valid snapshot', async () => {
    const { validateTrophyDetails } = await import('../collector/src/storage.js');
    const snapshot = JSON.parse(await fs.readFile('data/current.json', 'utf8'));
    snapshot.games = [snapshot.games.find((g: any) => g.id === 'NPWR12310_00')];
    snapshot.games[0].trophies = [];
    expect(() => validateTrophyDetails(snapshot)).toThrow('Missing trophy details');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'psn-reject-'));
    try {
      await fs.writeFile(path.join(dir, 'current.json'), 'previous');
      await expect(validateAndSaveSnapshot(dir, snapshot)).rejects.toThrow('Missing trophy details');
      expect(await fs.readFile(path.join(dir, 'current.json'), 'utf8')).toBe('previous');
    } finally { await fs.rm(dir, { recursive: true }); }
  });

  it('paginates all groups and rejects API error bodies and incomplete pages', async () => {
    const { fetchAllTrophies } = await import('../collector/src/trophies.js');
    const offsets: number[] = [];
    const result = await fetchAllTrophies(async offset => {
      offsets.push(offset);
      return { totalItemCount: 3, trophies: offset === 0 ? [{ trophyId: 0 }, { trophyId: 1 }] : [{ trophyId: 2 }] };
    });
    expect(offsets).toEqual([0, 2]);
    expect(result.trophies).toHaveLength(3);
    await expect(fetchAllTrophies(async () => ({ error: {}, trophies: [], totalItemCount: 0 }))).rejects.toThrow('Invalid');
    await expect(fetchAllTrophies(async () => ({ trophies: [], totalItemCount: 3 }))).rejects.toThrow('Incomplete');
  });
});
