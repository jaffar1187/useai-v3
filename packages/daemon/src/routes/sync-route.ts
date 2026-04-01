import { Hono } from "hono";
import { syncSessions } from "@devness/useai-cloud";
import { getConfig, readSessionsForRange, readV1Sessions, patchConfig } from "@devness/useai-storage";

export const syncRouteRoutes = new Hono();

syncRouteRoutes.post("/", async (c) => {
  const config = await getConfig();
  if (!config.auth?.token) {
    return c.json({ ok: false, error: "Not authenticated" }, 401);
  }
  try {
    const [sessions, v1Sessions] = await Promise.all([
      readSessionsForRange(32),
      readV1Sessions(),
    ]);

    // Sync all sessions (v3 + v1 both return Session type)
    const allSessions = [...sessions, ...v1Sessions];
    const result = await syncSessions(config.auth.token, allSessions, config);

    await patchConfig({ lastSyncAt: new Date().toISOString() });
    return c.json({ ok: true, data: result });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});
