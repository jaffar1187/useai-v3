import { z } from "zod";

const AuthUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  username: z.string().optional(),
});

export const UseaiConfigSchema = z.object({
  version: z.number().default(3),

  auth: z.object({
    token: z.string().optional(),
    user: AuthUserSchema.optional(),
  }).default({}),

  evaluation: z.object({
    framework: z.enum(["space", "aps", "raw", "calibrated"]).default("calibrated"),
  }).default({}),

  capture: z.object({
    prompt: z.boolean().default(false),
    promptImages: z.boolean().default(false),
    evaluation: z.boolean().default(true),
    milestones: z.boolean().default(true),
    reasonsLevel: z.enum(["none", "summary", "detailed"]).default("summary"),
  }).default({}),

  sync: z.object({
    enabled: z.boolean().default(false),
    autoSync: z.boolean().default(false),
    intervalMinutes: z.number().default(30),
  }).default({}),

  lastSyncAt: z.string().optional(),

  daemon: z.object({
    port: z.number().default(19200),
    idleTimeoutMinutes: z.number().default(30),
    orphanSweepMinutes: z.number().default(15),
  }).default({}),
});

export type UseaiConfig = z.infer<typeof UseaiConfigSchema>;
export type AuthUser = z.infer<typeof AuthUserSchema>;
