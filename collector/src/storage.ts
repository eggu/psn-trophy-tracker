import fs from "node:fs/promises";
import path from "node:path";
import {
  type CanonicalSnapshot,
  CanonicalSnapshotSchema,
  type SnapshotMetadata
} from "../../schemas/index.js";

export interface SaveSnapshotResult {
  snapshotPath: string;
  historyPath: string;
  isNew: boolean;
}

export async function loadCurrentSnapshot(dataDir: string): Promise<CanonicalSnapshot | null> {
  const currentPath = path.join(dataDir, "current.json");
  try {
    const raw = await fs.readFile(currentPath, "utf-8");
    const json = JSON.parse(raw);
    const parsed = CanonicalSnapshotSchema.safeParse(json);
    if (!parsed.success) {
      console.warn("Existing current.json failed validation:", parsed.error.issues);
      return null;
    }
    return parsed.data;
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function validateAndSaveSnapshot(
  dataDir: string,
  snapshot: CanonicalSnapshot
): Promise<SaveSnapshotResult> {
  // 1. Schema validation
  const validation = CanonicalSnapshotSchema.safeParse(snapshot);
  if (!validation.success) {
    throw new Error(
      `Snapshot validation failed: ${JSON.stringify(validation.error.issues, null, 2)}`
    );
  }

  // 2. Consistency validation: Profile trophy counts vs games calculation if needed
  if (snapshot.games.length === 0 && snapshot.profile.trophies.total > 0) {
    console.warn("Warning: games list is empty despite profile trophy count > 0");
  }

  validateTrophyDetails(validation.data);
  const validSnapshot = validation.data;
  const isoTime = validSnapshot.metadata.lastSuccessfulSync;
  const dateObj = new Date(isoTime);
  const year = String(dateObj.getUTCFullYear());
  const month = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
  const timeSlug = isoTime.replace(/[:.]/g, "-");

  const historyDir = path.join(dataDir, "history", year, month);
  await fs.mkdir(historyDir, { recursive: true });

  const historyPath = path.join(historyDir, `${timeSlug}.json`);
  const currentPath = path.join(dataDir, "current.json");
  const tmpPath = path.join(dataDir, "current.json.tmp");

  const serialized = JSON.stringify(validSnapshot, null, 2);

  // Write history snapshot
  await fs.writeFile(historyPath, serialized, "utf-8");

  // Atomic write to current.json: write to tmp then rename
  await fs.writeFile(tmpPath, serialized, "utf-8");
  await fs.rename(tmpPath, currentPath);

  return {
    snapshotPath: currentPath,
    historyPath,
    isNew: true
  };
}

export function validateTrophyDetails(snapshot: CanonicalSnapshot): void {
  for (const game of snapshot.games) {
    if (game.progress.total > 0 && game.trophies.length === 0) {
      throw new Error(`Missing trophy details: ${game.id} (${game.platform.join(",")}), expected ${game.progress.total}`);
    }
    const ids = new Set(game.trophies.map(t => String(t.id)));
    if (ids.size !== game.trophies.length) throw new Error(`Duplicate trophy IDs: ${game.id}`);
    // PSN title summaries can lag behind definition/DLC revisions; retain complete API responses and report discrepancies.
    for (const grade of ["platinum", "gold", "silver", "bronze"] as const) {
      const trophies = game.trophies.filter(t => t.grade === grade);
      if (trophies.length !== game.trophySummary[grade].total || trophies.filter(t => t.earned).length !== game.trophySummary[grade].earned) {
        console.warn(`[Validation] ${game.id} ${grade} summary/detail mismatch`);
      }
    }
    if (game.trophies.length !== game.progress.total) console.warn(`[Validation] ${game.id}: details=${game.trophies.length}, summary=${game.progress.total}`);
  }
}
