import { Hono } from "hono";
import { syncPrompts } from "@devness/useai-cloud";
import { getConfig, patchConfig } from "@devness/useai-storage";

export const syncRouteRoutes = new Hono();

syncRouteRoutes.post("/", async (c) => {
  const config = await getConfig();
  if (!config.auth?.token) {
    return c.json({ ok: false, error: "Not authenticated" }, 401);
  }
  try {
    const result = await syncPrompts(config.auth.token, config);

    if (result.synced > 0) {
      await patchConfig({ lastSyncAt: new Date().toISOString() });
    }

    const ok = result.errors === 0;
    return c.json({ ok, data: result });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});
