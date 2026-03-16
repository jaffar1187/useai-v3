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
// Maps v3 camelCase fields to the snake_case shape the dashboard FullConfig expects.
configRoutes.get("/full", async (c) => {
  const config = await getConfig();

  // Map v3 reasonsLevel → dashboard evaluation_reasons
  const reasonsMap: Record<string, "all" | "below_perfect" | "none"> = {
    detailed: "all",
    summary: "below_perfect",
    none: "none",
  };

  const full = {
    mode: "local" as const,
    authenticated: Boolean(config.auth.token),
    email: config.auth.user?.email ?? null,
    evaluation_framework: config.evaluation.framework,
    capture: {
      prompt: config.capture.prompt,
      prompt_images: config.capture.promptImages,
      evaluation: config.capture.evaluation,
      evaluation_reasons: reasonsMap[config.capture.reasonsLevel] ?? "below_perfect",
      milestones: config.capture.milestones,
    },
    sync: {
      enabled: config.sync.enabled,
      interval_hours: config.sync.intervalMinutes / 60,
    },
  };

  return c.json(full);
});

// PATCH /api/local/config — accepts dashboard-shaped updates and translates to v3
configRoutes.patch("/", async (c) => {
  const body = await c.req.json() as Record<string, unknown>;
  const current = await getConfig();

  // Map dashboard evaluation_reasons → v3 reasonsLevel
  const reasonsReverseMap: Record<string, "none" | "summary" | "detailed"> = {
    all: "detailed",
    below_perfect: "summary",
    none: "none",
  };

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
      ...(typeof evaluation === "boolean" && { evaluation }),
      ...(typeof milestones === "boolean" && { milestones }),
      ...(typeof evaluationReasons === "string" && {
        reasonsLevel: reasonsReverseMap[evaluationReasons] ?? "summary",
      }),
    };
  }

  const bodySync = body["sync"];
  if (bodySync && typeof bodySync === "object") {
    const sync = bodySync as Record<string, unknown>;
    const enabled = sync["enabled"];
    const intervalHours = sync["interval_hours"];
    current.sync = {
      ...current.sync,
      ...(typeof enabled === "boolean" && { enabled }),
      ...(typeof intervalHours === "number" && { intervalMinutes: intervalHours * 60 }),
    };
  }

  const fw = body["evaluation_framework"];
  if (typeof fw === "string" && (fw === "space" || fw === "aps" || fw === "raw" || fw === "calibrated")) {
    current.evaluation = { ...current.evaluation, framework: fw };
  }

  await saveConfig(current);

  // Return dashboard-shaped FullConfig (same shape as GET /full)
  const reasonsMap: Record<string, "all" | "below_perfect" | "none"> = {
    detailed: "all",
    summary: "below_perfect",
    none: "none",
  };

  const full = {
    mode: "local" as const,
    authenticated: Boolean(current.auth.token),
    email: current.auth.user?.email ?? null,
    evaluation_framework: current.evaluation.framework,
    capture: {
      prompt: current.capture.prompt,
      prompt_images: current.capture.promptImages,
      evaluation: current.capture.evaluation,
      evaluation_reasons: reasonsMap[current.capture.reasonsLevel] ?? "below_perfect",
      milestones: current.capture.milestones,
    },
    sync: {
      enabled: current.sync.enabled,
      interval_hours: current.sync.intervalMinutes / 60,
    },
    instructions_updated: [] as string[],
  };

  return c.json(full);
});
