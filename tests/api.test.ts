import { describe, it, expect } from "vitest";
import { handleApiRequest } from "../worker/src/router.js";
import type { CanonicalSnapshot } from "../schemas/index.js";

const mockSnapshot: CanonicalSnapshot = {
  metadata: {
    schemaVersion: 1,
    generatedAt: "2026-09-30T03:00:00Z",
    lastSuccessfulSync: "2026-09-30T03:00:00Z",
    source: "playstation-network"
  },
  profile: {
    onlineId: "eggu_",
    trophyLevel: 420,
    progress: 88,
    trophies: {
      platinum: 10,
      gold: 50,
      silver: 150,
      bronze: 500,
      total: 710
    },
    games: {
      total: 2,
      completed: 1
    },
    lastSuccessfulSync: "2026-09-30T03:00:00Z"
  },
  games: [
    {
      id: "NPWR001",
      name: "SILENT HILL f",
      platform: ["PS5"],
      progress: {
        earned: 38,
        total: 43,
        percentage: 88
      },
      platinumEarned: false,
      lastTrophyAt: "2026-09-29T12:00:00Z",
      trophySummary: {
        platinum: { earned: 0, total: 1 },
        gold: { earned: 5, total: 6 },
        silver: { earned: 10, total: 12 },
        bronze: { earned: 23, total: 24 }
      },
      trophies: [
        {
          id: 1,
          name: "True Ending",
          description: "Clear the game on nightmare",
          grade: "gold",
          hidden: true,
          earned: true,
          earnedAt: "2026-09-29T12:00:00Z",
          groupId: "default"
        },
        {
          id: 2,
          name: "Collector",
          description: "Collect all notes",
          grade: "silver",
          hidden: false,
          earned: false,
          groupId: "default"
        }
      ]
    },
    {
      id: "NPWR002",
      name: "Astro Bot",
      platform: ["PS5"],
      progress: {
        earned: 44,
        total: 44,
        percentage: 100
      },
      platinumEarned: true,
      lastTrophyAt: "2026-09-25T10:00:00Z",
      trophySummary: {
        platinum: { earned: 1, total: 1 },
        gold: { earned: 5, total: 5 },
        silver: { earned: 10, total: 10 },
        bronze: { earned: 28, total: 28 }
      },
      trophies: []
    }
  ]
};

describe("Agent API Router", () => {
  it("GET /api/v1/status returns status ok and fresh data status", async () => {
    const res = await handleApiRequest({
      snapshot: mockSnapshot,
      requestUrl: "http://localhost/api/v1/status"
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("ok");
    expect(body.schemaVersion).toBe(1);
    expect(body.lastSuccessfulSync).toBe("2026-09-30T03:00:00Z");
  });

  it("GET /api/v1/status returns stale when snapshot is missing", async () => {
    const res = await handleApiRequest({
      snapshot: null,
      requestUrl: "http://localhost/api/v1/status"
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("ok");
    expect(body.dataStatus).toBe("stale");
  });

  it("GET /api/v1/profile returns profile information", async () => {
    const res = await handleApiRequest({
      snapshot: mockSnapshot,
      requestUrl: "http://localhost/api/v1/profile"
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.onlineId).toBe("eggu_");
    expect(body.trophies.platinum).toBe(10);
  });

  it("GET /api/v1/games supports completed filtering and pagination", async () => {
    const res = await handleApiRequest({
      snapshot: mockSnapshot,
      requestUrl: "http://localhost/api/v1/games?completed=true"
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total).toBe(1);
    expect(body.games[0].name).toBe("Astro Bot");
  });

  it("GET /api/v1/games/:id returns game detail", async () => {
    const res = await handleApiRequest({
      snapshot: mockSnapshot,
      requestUrl: "http://localhost/api/v1/games/NPWR001"
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe("NPWR001");
    expect(body.name).toBe("SILENT HILL f");
    expect(body.progress.earned).toBe(38);
  });

  it("GET /api/v1/games/:id/trophies returns filtered trophy list", async () => {
    const res = await handleApiRequest({
      snapshot: mockSnapshot,
      requestUrl: "http://localhost/api/v1/games/NPWR001/trophies?earned=false"
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total).toBe(1);
    expect(body.trophies[0].name).toBe("Collector");
  });

  it("GET /api/v1/trophies/recent returns recent trophies", async () => {
    const res = await handleApiRequest({
      snapshot: mockSnapshot,
      requestUrl: "http://localhost/api/v1/trophies/recent?limit=5"
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.trophies.length).toBe(1);
    expect(body.trophies[0].trophy.name).toBe("True Ending");
  });

  it("GET /api/v1/changes calculates delta", async () => {
    const res = await handleApiRequest({
      snapshot: mockSnapshot,
      requestUrl: "http://localhost/api/v1/changes"
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.summaryDelta).toBeDefined();
    expect(body.changedGames).toBeDefined();
  });

  it("handles 404 for unknown game or path", async () => {
    const res = await handleApiRequest({
      snapshot: mockSnapshot,
      requestUrl: "http://localhost/api/v1/games/UNKNOWN"
    });
    expect(res.status).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("GAME_NOT_FOUND");
  });
});
