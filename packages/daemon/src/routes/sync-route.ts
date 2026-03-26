import { Hono } from "hono";
import { syncSessions, syncV1Sessions } from "@devness/useai-cloud";
import { getConfig, readSessionsForRange, readV1Sessions, patchConfig } from "@devness/useai-storage";

export const syncRouteRoutes = new Hono();

syncRouteRoutes.post("/", async (c) => {
  const config = await getConfig();
  if (!config.auth?.token) {
    return c.json({ ok: false, error: "Not authenticated" }, 401);
  }
  try {
    const [sessions, v1Sessions] = await Promise.all([
      readSessionsForRange(30),
      readV1Sessions(),
    ]);

    // Sync v3 sessions
    const result = await syncSessions(config.auth.token, sessions, config);

    // Sync v1 legacy sessions (already snake_case)
    if (v1Sessions.length > 0) {
      const v1Result = await syncV1Sessions(
        config.auth.token,
        v1Sessions as Array<{ session_id: string; client: string; task_type: string; started_at: string; ended_at: string; duration_seconds: number; languages?: string[]; [key: string]: unknown }>,
      );
      result.synced += v1Result.synced;
      result.skipped += v1Result.skipped;
      result.errors += v1Result.errors;
    }

    await patchConfig({ lastSyncAt: new Date().toISOString() });
    return c.json({ ok: true, data: result });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});
