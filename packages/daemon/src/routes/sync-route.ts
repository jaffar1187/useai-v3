import { Hono } from "hono";
import { syncSessions } from "@devness/useai-cloud";
import { getConfig, readSessionsForRange, patchConfig } from "@devness/useai-storage";

export const syncRouteRoutes = new Hono();

syncRouteRoutes.post("/", async (c) => {
  const config = await getConfig();
  if (!config.auth?.token) {
    return c.json({ ok: false, error: "Not authenticated" }, 401);
  }
  try {
    const sessions = await readSessionsForRange(30);
    const result = await syncSessions(config.auth.token, sessions, config);
    await patchConfig({ lastSyncAt: new Date().toISOString() });
    return c.json({ ok: true, data: result });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});
