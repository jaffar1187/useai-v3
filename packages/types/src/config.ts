import { z } from "zod";

const AuthUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  username: z.string().nullable().optional(),
});

export const UseaiConfigSchema = z.object({
  version: z.number().default(3),

  auth: z
    .object({
      token: z.string().optional(),
      user: AuthUserSchema.optional(),
    })
    .default({}),

  evaluation: z
    .object({
      framework: z
        .enum(["space", "aps", "raw", "calibrated"])
        .default("calibrated"),
    })
    .default({}),

  capture: z
    .object({
      prompt: z.boolean().default(false),
      // e.g. [{ type: "image", description: "Screenshot of dashboard nav tabs" }]
      promptImages: z.boolean().default(false),
    })
    .default({}),

  sync: z
    .object({
      autoSync: z.boolean().default(false),
      intervalMinutes: z.number().default(30),

      // Sync anonymous aggregates (total hours, session counts, streaks, language breakdown)
      includeLeaderboardStats: z.boolean().default(true),
      // e.g. { prompt_quality: 4, context_provided: 5, scope_quality: 3, ... }
      includeEvaluation: z.boolean().default(true),
      // e.g. [{ title: "Implemented auth flow", category: "feature", complexity: "medium" }]
      includeMilestones: z.boolean().default(true),
      // Sync private titles and project names. When false, these are stripped before upload for privacy.
      includePrivateDetails: z.boolean().default(true),
      // e.g. "below_perfect" → stores reasons only for scores below 5/5
      includeEvaluationReasons: z.enum(["none", "below_perfect", "all"]).default("below_perfect"),
    })
    .default({}),

  lastSyncAt: z.string().optional(),

  daemon: z
    .object({
      port: z.number().default(19200),
    })
    .default({}),
});

export type UseaiConfig = z.infer<typeof UseaiConfigSchema>;
export type AuthUser = z.infer<typeof AuthUserSchema>;
