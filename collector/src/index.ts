import path from "node:path";
import {
  exchangeNpssoForCode,
  exchangeCodeForAccessToken,
  getUserTitles,
  getUserTrophiesEarnedForTitle,
  getTitleTrophies,
  getTitleTrophyGroups,
  getProfileFromUserName
} from "psn-api";
import type { CanonicalSnapshot, GameTitle, Profile } from "../../schemas/index.js";
import { parseTrophyTitleItem, mergeTrophyDefinitionsAndEarned, getNpServiceName } from "./parser.js";
import { loadCurrentSnapshot, validateAndSaveSnapshot, validateTrophyDetails } from "./storage.js";
import { collectLocalizedMetadata } from "./localization.js";
import { fetchAllTrophies } from "./trophies.js";
import { computeSnapshotDiff } from "./diff.js";

function sanitize(msg: string): string {
  // Redact secrets if any accidentally logged
  return msg.replace(/(npsso=)[^& \n]+/gi, "$1[REDACTED]")
            .replace(/(Bearer\s+)[a-zA-Z0-9._-]+/gi, "$1[REDACTED]");
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryWithBackoff<T>(fn: () => Promise<T>, retries = 3, initialDelay = 1000): Promise<T> {
  let attempt = 0;
  let currentDelay = initialDelay;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      if (attempt >= retries) throw err;
      console.warn(`[Collector] Request failed (attempt ${attempt}/${retries}): ${sanitize(err?.message || String(err))}. Retrying in ${currentDelay}ms...`);
      await delay(currentDelay);
      currentDelay *= 2;
    }
  }
}

export async function runCollector(options?: {
  npsso?: string;
  targetOnlineId?: string;
  dataDir?: string;
  dryRun?: boolean;
  full?: boolean;
}) {
  const startTime = Date.now();
  console.log("[Collector] Starting PSN Trophy Sync job...");

  const targetOnlineId = options?.targetOnlineId || process.env.PSN_TARGET_ONLINE_ID || "eggu_";
  const npsso = options?.npsso || process.env.PSN_NPSSO;
  const dataDir = options?.dataDir || path.resolve(process.cwd(), "data");

  if (!npsso) {
    throw new Error(
      "Missing PSN_NPSSO environment variable. Please set it in GitHub Secrets or local .env."
    );
  }

  // 1. Authenticate with PSN
  console.log(`[Collector] Authenticating using NPSSO for target user: ${targetOnlineId}`);
  const accessCode = await retryWithBackoff(() => exchangeNpssoForCode(npsso));
  const authorization = await retryWithBackoff(() => exchangeCodeForAccessToken(accessCode));
  console.log("[Collector] Successfully acquired PSN Access Token.");

  // 2. Fetch User Profile
  console.log(`[Collector] Fetching user profile for ${targetOnlineId}...`);
  const rawProfile = await retryWithBackoff(() =>
    getProfileFromUserName(authorization, targetOnlineId)
  );
  const accountId = rawProfile?.profile?.accountId || "me";

  // 3. Load previous snapshot if exists for comparison / incremental check
  const prevSnapshot = await loadCurrentSnapshot(dataDir);

  // 4. Fetch User Trophy Titles (with pagination)
  console.log("[Collector] Fetching trophy title list...");
  const rawTitles: any[] = [];
  let offset = 0;
  const limit = 100;
  let totalTitleCount = 0;

  while (true) {
    const titlesPage = await retryWithBackoff(() =>
      getUserTitles(authorization, accountId, { offset, limit })
    );

    if (!Array.isArray(titlesPage.trophyTitles) || !Number.isInteger(titlesPage.totalItemCount) || titlesPage.totalItemCount < 0) throw new Error("Invalid trophy title API response");
    totalTitleCount = titlesPage.totalItemCount;
    if (titlesPage.trophyTitles && titlesPage.trophyTitles.length > 0) {
      rawTitles.push(...titlesPage.trophyTitles);
    }

    offset += limit;
    if (offset >= totalTitleCount || !titlesPage.trophyTitles || titlesPage.trophyTitles.length === 0) {
      break;
    }
    await delay(300); // polite rate limit
  }

  console.log(`[Collector] Found ${rawTitles.length} total titles.`);

  // 5. Build parsed game titles & fetch individual trophies
  const games: GameTitle[] = [];
  let totalPlat = 0;
  let totalGold = 0;
  let totalSilver = 0;
  let totalBronze = 0;
  let totalCompletedGames = 0;

  for (let i = 0; i < rawTitles.length; i++) {
    const rawTitle = rawTitles[i];
    const parsedGame = parseTrophyTitleItem(rawTitle);

    totalPlat += parsedGame.trophySummary.platinum.earned;
    totalGold += parsedGame.trophySummary.gold.earned;
    totalSilver += parsedGame.trophySummary.silver.earned;
    totalBronze += parsedGame.trophySummary.bronze.earned;

    if (parsedGame.progress.earned > 0 && parsedGame.progress.earned === parsedGame.progress.total) {
      totalCompletedGames++;
    }

    // Check if we need to fetch trophy details (only for games with trophies)
    const npCommunicationId = rawTitle.npCommunicationId;
    if (npCommunicationId) {
      // Find if title changed compared to previous snapshot
      const prevGame = prevSnapshot?.games.find((g) => g.id === parsedGame.id);
      const npServiceName = getNpServiceName(rawTitle);
      const isUnchanged =
        !options?.full && process.env.PSN_FULL_SYNC !== "true" && prevGame &&
        prevGame.trophySetVersion === parsedGame.trophySetVersion &&
        prevGame.progress.total === parsedGame.progress.total &&
        prevGame.lastTrophyAt === parsedGame.lastTrophyAt &&
        prevGame.progress.earned === parsedGame.progress.earned &&
        prevGame.trophies.length === parsedGame.progress.total &&
        prevGame.trophies.filter(t => t.earned).length === parsedGame.progress.earned;

      if (isUnchanged) {
        // Reuse cached trophies from previous snapshot to save API calls
        parsedGame.trophies = prevGame.trophies;
      } else {
        try {
          console.log(
            `[Collector] [${i + 1}/${rawTitles.length}] Fetching trophies for: ${parsedGame.name} (${npCommunicationId})...`
          );
          console.log(JSON.stringify({ stage: "discovery", titleId: npCommunicationId, npServiceName, platform: parsedGame.platform, version: parsedGame.trophySetVersion }));
          // Definition & user earned
          const trophyDefs = await retryWithBackoff(() =>
            fetchAllTrophies(offset => getTitleTrophies(authorization, npCommunicationId, "all", { npServiceName, offset, limit: 1000 }))
          );

          console.log(JSON.stringify({ stage: "definitions", titleId: npCommunicationId, npServiceName, count: trophyDefs.trophies.length, version: trophyDefs.trophySetVersion, success: true }));
          const earnedTrophies = await retryWithBackoff(() =>
            fetchAllTrophies(offset => getUserTrophiesEarnedForTitle(authorization, accountId, npCommunicationId, "all", { npServiceName, offset, limit: 1000 }))
          );

          console.log(JSON.stringify({ stage: "earned", titleId: npCommunicationId, npServiceName, count: earnedTrophies.trophies.length, version: earnedTrophies.trophySetVersion, success: true }));
          const mergedTrophies = mergeTrophyDefinitionsAndEarned(
            trophyDefs.trophies ?? [],
            earnedTrophies.trophies ?? []
          );
          parsedGame.trophies = mergedTrophies;
          console.log(JSON.stringify({ stage: "merge", titleId: npCommunicationId, count: mergedTrophies.length, earned: mergedTrophies.filter(t => t.earned).length }));
          await delay(250); // polite rate limit
        } catch (fetchErr: any) {
          console.warn(
            `[Collector] Warning: Failed fetching trophy details for ${parsedGame.name}: ${sanitize(fetchErr?.message || String(fetchErr))}. Falling back to previous cached or empty.`
          );
          if (prevGame?.trophies) {
            parsedGame.trophies = prevGame.trophies;
          }
        }
      }
      for (const locale of ["ko-KR", "en-US"] as const) {
        try {
          const status = await collectLocalizedMetadata(parsedGame, prevGame, async () => {
            const headerOverrides = { "Accept-Language": locale };
            const definitions = await retryWithBackoff(() => fetchAllTrophies(offset => getTitleTrophies(authorization, npCommunicationId, "all", { npServiceName, headerOverrides, offset, limit: 1000 })));
            const groups = await retryWithBackoff(() => getTitleTrophyGroups(authorization, npCommunicationId, { npServiceName, headerOverrides }));
            if (!groups.trophyTitleName || groups.trophySetVersion !== definitions.trophySetVersion) throw new Error("Invalid localized title metadata response");
            await delay(250);
            return { name: groups.trophyTitleName, version: definitions.trophySetVersion, trophies: definitions.trophies };
          }, locale);
          console.log(JSON.stringify({ stage: "localization", titleId: parsedGame.id, locale, status }));
        } catch {
          // Optional metadata must never prevent a valid trophy sync. No negative cache on failed requests.
          console.warn(`[Collector] ${locale} metadata unavailable for ${parsedGame.id}; retry on next sync`);
        }
      }
    }

    console.log(JSON.stringify({ stage: "canonical", titleId: parsedGame.id, platform: parsedGame.platform, version: parsedGame.trophySetVersion, count: parsedGame.trophies.length }));
    games.push(parsedGame);
  }

  const syncTimestamp = new Date().toISOString();

  const profile: Profile = {
    onlineId: targetOnlineId,
    accountId: accountId !== "me" ? accountId : undefined,
    avatarUrl: rawProfile?.profile?.avatarUrls?.[0]?.avatarUrl || "",
    trophyLevel: rawProfile?.profile?.trophySummary?.level || 0,
    progress: rawProfile?.profile?.trophySummary?.progress || 0,

    trophies: {
      platinum: totalPlat,
      gold: totalGold,
      silver: totalSilver,
      bronze: totalBronze,
      total: totalPlat + totalGold + totalSilver + totalBronze
    },
    games: {
      total: games.length,
      completed: totalCompletedGames
    },
    lastSuccessfulSync: syncTimestamp
  };


  const snapshot: CanonicalSnapshot = {
    metadata: {
      schemaVersion: 1,
      generatedAt: syncTimestamp,
      lastSuccessfulSync: syncTimestamp,
      source: "playstation-network"
    },
    profile,
    games
  };

  // 6. Validate & Save
  console.log("[Collector] Validating and writing canonical snapshot...");
  validateTrophyDetails(snapshot);
  if (options?.dryRun) {
    console.log("[Collector] Dry run enabled, skipping storage write.");
  } else {
    const saveResult = await validateAndSaveSnapshot(dataDir, snapshot);
    console.log(`[Collector] Current snapshot updated at: ${saveResult.snapshotPath}`);
    console.log(`[Collector] Snapshot archived to history at: ${saveResult.historyPath}`);
  }

  // 7. Calculate diff
  const diff = computeSnapshotDiff(prevSnapshot, snapshot);
  console.log(`[Collector] Sync Summary:`);
  console.log(`  - Total Games: ${games.length}`);
  console.log(`  - New Trophies Earned Since Last Sync: ${diff.newTrophies.length}`);
  console.log(`  - Total Duration: ${((Date.now() - startTime) / 1000).toFixed(2)}s`);

  return { snapshot, diff };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  runCollector()
    .then(() => {
      console.log("[Collector] Process finished successfully.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[Collector] Fatal Error during collection:", sanitize(err?.message || String(err)));
      process.exit(1);
    });
}
