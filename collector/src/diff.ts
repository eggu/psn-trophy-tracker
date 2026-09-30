import type { CanonicalSnapshot, GameTitle, Trophy } from "../../schemas/index.js";

export interface DiffResult {
  from: string | null;
  to: string;
  summaryDelta: {
    total: number;
    platinum: number;
    gold: number;
    silver: number;
    bronze: number;
  };
  newTrophies: Array<{
    gameId: string;
    gameName: string;
    trophy: Trophy;
  }>;
  changedGames: Array<{
    id: string;
    name: string;
    previous?: {
      earned: number;
      total: number;
      percentage: number;
    };
    current: {
      earned: number;
      total: number;
      percentage: number;
    };
  }>;
}

export function computeSnapshotDiff(
  previous: CanonicalSnapshot | null,
  current: CanonicalSnapshot
): DiffResult {
  const from = previous ? previous.metadata.lastSuccessfulSync : null;
  const to = current.metadata.lastSuccessfulSync;

  const prevSummary = previous?.profile.trophies ?? {
    platinum: 0,
    gold: 0,
    silver: 0,
    bronze: 0,
    total: 0
  };

  const currSummary = current.profile.trophies;

  const summaryDelta = {
    platinum: currSummary.platinum - prevSummary.platinum,
    gold: currSummary.gold - prevSummary.gold,
    silver: currSummary.silver - prevSummary.silver,
    bronze: currSummary.bronze - prevSummary.bronze,
    total: currSummary.total - prevSummary.total
  };

  const prevGameMap = new Map<string, GameTitle>();
  if (previous) {
    for (const game of previous.games) {
      prevGameMap.set(game.id, game);
    }
  }

  const newTrophies: DiffResult["newTrophies"] = [];
  const changedGames: DiffResult["changedGames"] = [];

  for (const currGame of current.games) {
    const prevGame = prevGameMap.get(currGame.id);

    if (!prevGame) {
      // New game entirely
      changedGames.push({
        id: currGame.id,
        name: currGame.name,
        current: currGame.progress
      });

      for (const t of currGame.trophies) {
        if (t.earned) {
          newTrophies.push({
            gameId: currGame.id,
            gameName: currGame.name,
            trophy: t
          });
        }
      }
    } else {
      // Existing game
      const earnedChanged = currGame.progress.earned !== prevGame.progress.earned;
      const totalChanged = currGame.progress.total !== prevGame.progress.total;

      if (earnedChanged || totalChanged) {
        changedGames.push({
          id: currGame.id,
          name: currGame.name,
          previous: prevGame.progress,
          current: currGame.progress
        });
      }

      // Check new individual trophies
      const prevTrophyIds = new Set(
        prevGame.trophies.filter((t) => t.earned).map((t) => String(t.id))
      );

      for (const t of currGame.trophies) {
        if (t.earned && !prevTrophyIds.has(String(t.id)) &&
          (prevGame.trophies.length > 0 || (t.earnedAt && Date.parse(t.earnedAt) > Date.parse(previous!.metadata.lastSuccessfulSync)))) {
          newTrophies.push({
            gameId: currGame.id,
            gameName: currGame.name,
            trophy: t
          });
        }
      }
    }
  }

  // Sort newTrophies by earnedAt descending if available
  newTrophies.sort((a, b) => {
    if (!a.trophy.earnedAt && !b.trophy.earnedAt) return 0;
    if (!a.trophy.earnedAt) return 1;
    if (!b.trophy.earnedAt) return -1;
    return new Date(b.trophy.earnedAt).getTime() - new Date(a.trophy.earnedAt).getTime();
  });

  return {
    from,
    to,
    summaryDelta,
    newTrophies,
    changedGames
  };
}
