import { Hono } from "hono";
import { getConfig, saveConfig } from "@devness/useai-storage";

export const configRoutes = new Hono();

// GET /api/local/config — LocalConfig shape expected by the dashboard
configRoutes.get("/", async (c) => {
  const config = await getConfig();
  return c.json({
    mode: "local",
    authenticated: Boolean(config.auth.token),
    email: config.auth.user?.email ?? null,
    username: config.auth.user?.username ?? null,
    last_sync_at: config.lastSyncAt ?? null,
    auto_sync: config.sync.autoSync,
  });
});

// GET /api/local/config/full — dashboard-shaped config
configRoutes.get("/full", async (c) => {
  const config = await getConfig();

  return c.json({
    mode: "local" as const,
    authenticated: Boolean(config.auth.token),
    email: config.auth.user?.email ?? null,
    evaluation_framework: config.evaluation.framework,
    capture: {
      prompt: config.capture.prompt,
      prompt_images: config.capture.promptImages,
      evaluation: config.sync.includeEvaluation,
      evaluation_reasons: config.sync.includeEvaluationReasons,
      milestones: config.sync.includeMilestones,
    },
    sync: {
      auto_sync: config.sync.autoSync,
      interval_hours: config.sync.intervalMinutes / 60,
      include_leaderboard_stats: config.sync.includeLeaderboardStats,
      include_private_details: config.sync.includePrivateDetails,
    },
  });
});

// PATCH /api/local/config — accepts dashboard-shaped updates and translates to v3
configRoutes.patch("/", async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>;
  const current = await getConfig();

  const bodyCapture = body["capture"];
  if (bodyCapture && typeof bodyCapture === "object") {
    const capture = bodyCapture as Record<string, unknown>;
    const prompt = capture["prompt"];
    const promptImages = capture["prompt_images"];
    const evaluation = capture["evaluation"];
    const milestones = capture["milestones"];
    const evaluationReasons = capture["evaluation_reasons"];
    current.capture = {
      ...current.capture,
      ...(typeof prompt === "boolean" && { prompt }),
      ...(typeof promptImages === "boolean" && { promptImages }),
    };
    current.sync = {
      ...current.sync,
      ...(typeof evaluation === "boolean" && { includeEvaluation: evaluation }),
      ...(typeof milestones === "boolean" && { includeMilestones: milestones }),
      ...(typeof evaluationReasons === "string" && {
        includeEvaluationReasons: evaluationReasons as "none" | "below_perfect" | "all",
      }),
    };
  }

  const bodySync = body["sync"];
  if (bodySync && typeof bodySync === "object") {
    const sync = bodySync as Record<string, unknown>;
    const autoSync = sync["auto_sync"];
    const intervalHours = sync["interval_hours"];
    const includeLeaderboardStats = sync["include_leaderboard_stats"];
    const includePrivateDetails = sync["include_private_details"];
    current.sync = {
      ...current.sync,
      ...(typeof autoSync === "boolean" && { autoSync }),
      ...(typeof intervalHours === "number" && {
        intervalMinutes: intervalHours * 60,
      }),
      ...(typeof includeLeaderboardStats === "boolean" && { includeLeaderboardStats }),
      ...(typeof includePrivateDetails === "boolean" && { includePrivateDetails }),
    };
  }

  //aps and raw are for backward compatibility, not in use right now.
  const fw = body["evaluation_framework"];
  if (
    typeof fw === "string" &&
    (fw === "space" || fw === "aps" || fw === "raw" || fw === "calibrated")
  ) {
    current.evaluation = { ...current.evaluation, framework: fw };
  }

  await saveConfig(current);

  return c.json({
    mode: "local" as const,
    authenticated: Boolean(current.auth.token),
    email: current.auth.user?.email ?? null,
    evaluation_framework: current.evaluation.framework,
    capture: {
      prompt: current.capture.prompt,
      prompt_images: current.capture.promptImages,
      evaluation: current.sync.includeEvaluation,
      evaluation_reasons: current.sync.includeEvaluationReasons,
      milestones: current.sync.includeMilestones,
    },
    sync: {
      auto_sync: current.sync.autoSync,
      interval_hours: current.sync.intervalMinutes / 60,
      include_leaderboard_stats: current.sync.includeLeaderboardStats,
      include_private_details: current.sync.includePrivateDetails,
    },
    instructions_updated: [] as string[],
  });
});
