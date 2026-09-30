import { z } from "zod";

export const TrophyGradeSchema = z.enum(["platinum", "gold", "silver", "bronze"]);
export type TrophyGrade = z.infer<typeof TrophyGradeSchema>;

export const TrophyRaritySchema = z.enum(["ultra_rare", "very_rare", "rare", "common"]).or(z.string());

export const TrophySchema = z.object({
  id: z.number().or(z.string()),
  name: z.string(),
  localized: z.object({ "ko-KR": z.object({ name: z.string(), description: z.string() }).optional(), "en-US": z.object({ name: z.string(), description: z.string() }).optional() }).optional(),
  description: z.string().optional().default(""),
  grade: TrophyGradeSchema,
  hidden: z.boolean().default(false),
  earned: z.boolean().default(false),
  earnedAt: z.string().nullable().optional(), // ISO 8601
  rarity: TrophyRaritySchema.optional(),
  rarityPercentage: z.number().optional(),
  iconUrl: z.string().url().optional().or(z.literal("")),
  groupId: z.string().optional().default("default")
});
export type Trophy = z.infer<typeof TrophySchema>;

export const TrophyCountSummarySchema = z.object({
  platinum: z.number().default(0),
  gold: z.number().default(0),
  silver: z.number().default(0),
  bronze: z.number().default(0),
  total: z.number().default(0)
});
export type TrophyCountSummary = z.infer<typeof TrophyCountSummarySchema>;

export const GameProgressSchema = z.object({
  earned: z.number().default(0),
  total: z.number().default(0),
  percentage: z.number().min(0).max(100).default(0)
});
export type GameProgress = z.infer<typeof GameProgressSchema>;

export const GameTitleSchema = z.object({
  id: z.string(), // npCommunicationId or titleId
  name: z.string(),
  localized: z.object({ "ko-KR": z.object({ name: z.string() }).optional(), "en-US": z.object({ name: z.string() }).optional() }).optional(),
  localization: z.preprocess(value => {
    const old = value as any;
    return old?.locale ? { [old.locale]: { trophySetVersion: old.trophySetVersion, checkedAt: old.checkedAt, status: old.status } } : value;
  }, z.record(z.string(), z.object({ trophySetVersion: z.string(), checkedAt: z.string(), status: z.enum(["available", "fallback"]) })).optional()),
  platform: z.array(z.string()).default([]),
  imageUrl: z.string().url().optional().or(z.literal("")),
  trophySetVersion: z.string().optional(),
  progress: GameProgressSchema,
  platinumEarned: z.boolean().default(false),
  lastTrophyAt: z.string().nullable().optional(), // ISO 8601
  trophySummary: z.object({
    platinum: z.object({ earned: z.number().default(0), total: z.number().default(0) }),
    gold: z.object({ earned: z.number().default(0), total: z.number().default(0) }),
    silver: z.object({ earned: z.number().default(0), total: z.number().default(0) }),
    bronze: z.object({ earned: z.number().default(0), total: z.number().default(0) })
  }),
  trophies: z.array(TrophySchema).optional().default([])
});
export type GameTitle = z.infer<typeof GameTitleSchema>;

export const ProfileSchema = z.object({
  onlineId: z.string(),
  accountId: z.string().optional(),
  avatarUrl: z.string().url().optional().or(z.literal("")),
  trophyLevel: z.number().default(0),
  progress: z.number().default(0), // progress to next level
  tier: z.number().optional(),
  trophies: TrophyCountSummarySchema,
  games: z.object({
    total: z.number().default(0),
    completed: z.number().default(0)
  }),
  lastSuccessfulSync: z.string() // ISO 8601
});
export type Profile = z.infer<typeof ProfileSchema>;

export const SnapshotMetadataSchema = z.object({
  schemaVersion: z.number().default(1),
  generatedAt: z.string(), // ISO 8601
  lastSuccessfulSync: z.string(), // ISO 8601
  source: z.literal("playstation-network").default("playstation-network")
});
export type SnapshotMetadata = z.infer<typeof SnapshotMetadataSchema>;

export const CanonicalSnapshotSchema = z.object({
  metadata: SnapshotMetadataSchema,
  profile: ProfileSchema,
  games: z.array(GameTitleSchema)
});
export type CanonicalSnapshot = z.infer<typeof CanonicalSnapshotSchema>;

// API Schemas
export const ApiStatusSchema = z.object({
  status: z.enum(["ok", "degraded", "error"]),
  dataStatus: z.enum(["fresh", "stale"]),
  lastSuccessfulSync: z.string().nullable(),
  lastSyncAttempt: z.string().nullable(),
  ageSeconds: z.number(),
  schemaVersion: z.number()
});
export type ApiStatus = z.infer<typeof ApiStatusSchema>;

export const ChangesResponseSchema = z.object({
  from: z.string().nullable(),
  to: z.string(),
  summaryDelta: z.object({
    total: z.number(),
    platinum: z.number(),
    gold: z.number(),
    silver: z.number(),
    bronze: z.number()
  }),
  newTrophies: z.array(
    z.object({
      gameId: z.string(),
      gameName: z.string(),
      trophy: TrophySchema
    })
  ),
  changedGames: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      previous: GameProgressSchema.optional(),
      current: GameProgressSchema
    })
  )
});
export type ChangesResponse = z.infer<typeof ChangesResponseSchema>;
