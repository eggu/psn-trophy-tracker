import type { GameTitle, Trophy, TrophyGrade } from "../../schemas/index.js";

export function normalizeGrade(gradeStr: string | undefined): TrophyGrade {
  if (!gradeStr) return "bronze";
  const lower = gradeStr.toLowerCase();
  if (lower.includes("platinum")) return "platinum";
  if (lower.includes("gold")) return "gold";
  if (lower.includes("silver")) return "silver";
  return "bronze";
}

export function parseTrophyTitleItem(rawTitle: any): GameTitle {
  const earnedTrophies = rawTitle.earnedTrophies ?? {};
  const definedTrophies = rawTitle.definedTrophies ?? {};

  const platEarned = earnedTrophies.platinum ?? 0;
  const goldEarned = earnedTrophies.gold ?? 0;
  const silverEarned = earnedTrophies.silver ?? 0;
  const bronzeEarned = earnedTrophies.bronze ?? 0;
  const totalEarned = platEarned + goldEarned + silverEarned + bronzeEarned;

  const platTotal = definedTrophies.platinum ?? 0;
  const goldTotal = definedTrophies.gold ?? 0;
  const silverTotal = definedTrophies.silver ?? 0;
  const bronzeTotal = definedTrophies.bronze ?? 0;
  const totalDefined = platTotal + goldTotal + silverTotal + bronzeTotal;

  const progressPct = rawTitle.progress ?? (totalDefined > 0 ? Math.round((totalEarned / totalDefined) * 100) : 0);

  const platforms: string[] = [];
  if (rawTitle.trophyTitlePlatform) {
    platforms.push(...rawTitle.trophyTitlePlatform.split(",").map((s: string) => s.trim()));
  }

  return {
    id: rawTitle.npCommunicationId ?? rawTitle.npTitleId ?? String(rawTitle.trophyTitleName),
    name: rawTitle.trophyTitleName ?? "Unknown Title",
    platform: platforms,
    imageUrl: rawTitle.trophyTitleIconUrl ?? "",
    trophySetVersion: rawTitle.trophySetVersion ?? "1.00",
    progress: {
      earned: totalEarned,
      total: totalDefined,
      percentage: progressPct
    },
    platinumEarned: platEarned > 0,
    lastTrophyAt: rawTitle.lastUpdatedDateTime ?? null,
    trophySummary: {
      platinum: { earned: platEarned, total: platTotal },
      gold: { earned: goldEarned, total: goldTotal },
      silver: { earned: silverEarned, total: silverTotal },
      bronze: { earned: bronzeEarned, total: bronzeTotal }
    },
    trophies: []
  };
}

export function mergeTrophyDefinitionsAndEarned(
  titleTrophies: any[],
  userEarnedTrophies: any[]
): Trophy[] {
  const earnedMap = new Map<number | string, any>();
  for (const earned of userEarnedTrophies) {
    earnedMap.set(earned.trophyId, earned);
  }

  return titleTrophies.map((def) => {
    const earnedData = earnedMap.get(def.trophyId);
    const isEarned = Boolean(earnedData?.earned);

    let rarityPct = def.trophyEarnedRate ? parseFloat(def.trophyEarnedRate) : undefined;
    if (isNaN(rarityPct as number)) rarityPct = undefined;

    return {
      id: def.trophyId,
      name: def.trophyName ?? `Trophy #${def.trophyId}`,
      description: def.trophyDetail ?? "",
      grade: normalizeGrade(def.trophyType),
      hidden: Boolean(def.trophyHidden),
      earned: isEarned,
      earnedAt: earnedData?.earnedDateTime ?? null,
      rarity: def.trophyRare !== undefined ? String(def.trophyRare) : undefined,
      rarityPercentage: rarityPct,
      iconUrl: def.trophyIconUrl ?? "",
      groupId: def.trophyGroupId ?? "default"
    };
  });
}
