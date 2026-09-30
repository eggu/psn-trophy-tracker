import type { CanonicalSnapshot, GameTitle, Trophy } from "../schemas/index.js";

export interface ApiHandlerOptions {
  snapshot: CanonicalSnapshot | null;
  historySnapshots?: CanonicalSnapshot[];
  requestUrl: string;
  method?: string;
  corsOrigin?: string;
}

export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export function jsonResponse(data: any, status = 200, corsOrigin = "*"): ApiResponse {
  return {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Cache-Control": "public, max-age=60, s-maxage=300"
    },
    body: JSON.stringify(data, null, 2)
  };
}

export function errorResponse(code: string, message: string, status = 400, corsOrigin = "*"): ApiResponse {
  return jsonResponse({ error: { code, message } }, status, corsOrigin);
}

export async function handleApiRequest(options: ApiHandlerOptions): Promise<ApiResponse> {
  const { snapshot, historySnapshots = [], requestUrl, method = "GET", corsOrigin = "*" } = options;

  if (method === "OPTIONS") {
    return {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": corsOrigin,
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      },
      body: ""
    };
  }

  const url = new URL(requestUrl, "http://localhost");
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  // 1. GET /api/v1/status
  if (pathname === "/api/v1/status") {
    const now = Date.now();
    const lastSync = snapshot?.metadata.lastSuccessfulSync || null;
    const ageSeconds = lastSync ? Math.floor((now - new Date(lastSync).getTime()) / 1000) : -1;
    // Considered stale if older than 12 hours (43200s) or no data
    const isStale = ageSeconds === -1 || ageSeconds > 43200;

    return jsonResponse({
      status: "ok",
      dataStatus: isStale ? "stale" : "fresh",
      lastSuccessfulSync: lastSync,
      lastSyncAttempt: snapshot?.metadata.generatedAt || null,
      ageSeconds: Math.max(0, ageSeconds),
      schemaVersion: snapshot?.metadata.schemaVersion ?? 1
    }, 200, corsOrigin);
  }

  // All other endpoints require existing snapshot
  if (!snapshot) {
    return errorResponse("NO_DATA", "No trophy data has been collected yet.", 503, corsOrigin);
  }

  // 2. GET /api/v1/profile
  if (pathname === "/api/v1/profile") {
    return jsonResponse(snapshot.profile, 200, corsOrigin);
  }

  // 3. GET /api/v1/games
  if (pathname === "/api/v1/games") {
    const platform = url.searchParams.get("platform");
    const completed = url.searchParams.get("completed");
    const sort = url.searchParams.get("sort") || "recent";
    const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get("limit") || "50", 10)));
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10));

    let games = snapshot.games.map((g) => {
      // Exclude full trophy array in list endpoint to save bandwidth
      const { trophies, ...summary } = g;
      return summary;
    });

    if (platform) {
      const pUpper = platform.toUpperCase();
      games = games.filter((g) => g.platform.some((p) => p.toUpperCase().includes(pUpper)));
    }

    if (completed !== null && completed !== undefined) {
      const isCompleted = completed === "true";
      games = games.filter((g) =>
        isCompleted
          ? g.platinumEarned || (g.progress.earned > 0 && g.progress.earned === g.progress.total)
          : !(g.platinumEarned || (g.progress.earned > 0 && g.progress.earned === g.progress.total))
      );
    }

    if (sort === "recent") {
      games.sort((a, b) => {
        if (!a.lastTrophyAt && !b.lastTrophyAt) return 0;
        if (!a.lastTrophyAt) return 1;
        if (!b.lastTrophyAt) return -1;
        return new Date(b.lastTrophyAt).getTime() - new Date(a.lastTrophyAt).getTime();
      });
    } else if (sort === "progress") {
      games.sort((a, b) => b.progress.percentage - a.progress.percentage);
    } else if (sort === "name") {
      games.sort((a, b) => a.name.localeCompare(b.name));
    }

    const total = games.length;
    const paginated = games.slice(offset, offset + limit);

    return jsonResponse({
      total,
      limit,
      offset,
      games: paginated
    }, 200, corsOrigin);
  }

  // 4. GET /api/v1/trophies/recent
  if (pathname === "/api/v1/trophies/recent") {
    const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get("limit") || "20", 10)));
    const since = url.searchParams.get("since");
    const sinceTime = since ? new Date(since).getTime() : null;

    const allEarned: Array<{ gameId: string; gameName: string; trophy: Trophy }> = [];

    for (const game of snapshot.games) {
      for (const t of game.trophies) {
        if (t.earned && t.earnedAt) {
          const tTime = new Date(t.earnedAt).getTime();
          if (sinceTime === null || tTime >= sinceTime) {
            allEarned.push({
              gameId: game.id,
              gameName: game.name,
              trophy: t
            });
          }
        }
      }
    }

    allEarned.sort((a, b) => {
      const timeA = a.trophy.earnedAt ? new Date(a.trophy.earnedAt).getTime() : 0;
      const timeB = b.trophy.earnedAt ? new Date(b.trophy.earnedAt).getTime() : 0;
      return timeB - timeA;
    });

    return jsonResponse({
      total: allEarned.length,
      limit,
      trophies: allEarned.slice(0, limit)
    }, 200, corsOrigin);
  }

  // 5. GET /api/v1/changes
  if (pathname === "/api/v1/changes") {
    const since = url.searchParams.get("since");
    let baseSnapshot: CanonicalSnapshot | null = null;

    if (since && historySnapshots.length > 0) {
      const targetTime = new Date(since).getTime();
      // find snapshot closest to or just before since
      const sortedHistory = [...historySnapshots].sort(
        (a, b) =>
          new Date(a.metadata.lastSuccessfulSync).getTime() -
          new Date(b.metadata.lastSuccessfulSync).getTime()
      );
      baseSnapshot = sortedHistory.find(
        (s) => new Date(s.metadata.lastSuccessfulSync).getTime() <= targetTime
      ) || sortedHistory[0];
    } else if (historySnapshots.length > 0) {
      // Use the immediate previous snapshot if available
      baseSnapshot = historySnapshots[historySnapshots.length - 1];
    }

    const { computeSnapshotDiff } = await import("./diffHelper.js");
    const diff = computeSnapshotDiff(baseSnapshot, snapshot);
    return jsonResponse(diff, 200, corsOrigin);
  }

  // 6. GET /api/v1/games/:id/trophies
  const trophiesMatch = pathname.match(/^\/api\/v1\/games\/([^/]+)\/trophies$/);
  if (trophiesMatch) {
    const gameId = decodeURIComponent(trophiesMatch[1]);
    const game = snapshot.games.find((g) => g.id === gameId);
    if (!game) {
      return errorResponse("GAME_NOT_FOUND", `Game '${gameId}' was not found.`, 404, corsOrigin);
    }

    let trophies = [...game.trophies];
    const earned = url.searchParams.get("earned");
    const grade = url.searchParams.get("grade");
    const hidden = url.searchParams.get("hidden");

    if (earned !== null) {
      const isEarned = earned === "true";
      trophies = trophies.filter((t) => t.earned === isEarned);
    }
    if (grade) {
      trophies = trophies.filter((t) => t.grade === grade.toLowerCase());
    }
    if (hidden !== null) {
      const isHidden = hidden === "true";
      trophies = trophies.filter((t) => t.hidden === isHidden);
    }

    return jsonResponse({
      gameId: game.id,
      gameName: game.name,
      total: trophies.length,
      trophies
    }, 200, corsOrigin);
  }

  // 7. GET /api/v1/games/:id
  const gameMatch = pathname.match(/^\/api\/v1\/games\/([^/]+)$/);
  if (gameMatch) {
    const gameId = decodeURIComponent(gameMatch[1]);
    const game = snapshot.games.find((g) => g.id === gameId);
    if (!game) {
      return errorResponse("GAME_NOT_FOUND", `Game '${gameId}' was not found.`, 404, corsOrigin);
    }
    const { trophies, ...summary } = game;
    return jsonResponse(summary, 200, corsOrigin);
  }

  return errorResponse("NOT_FOUND", "Endpoint not found.", 404, corsOrigin);
}
