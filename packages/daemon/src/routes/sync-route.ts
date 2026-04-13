import { Hono } from "hono";
import { syncPrompts } from "@devness/useai-cloud";
import { getConfig, patchConfig } from "@devness/useai-storage";
import { DAEMON_URL } from "@devness/useai-storage/paths";
import type { Session } from "@devness/useai-types";

export const syncRouteRoutes = new Hono();

async function fetchAllPrompts(start: string, end: string): Promise<Session[]> {
  const all: Session[] = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const params = new URLSearchParams({
      start,
      end,
      offset: String(offset),
      limit: String(limit),
    });
    const res = await fetch(`${DAEMON_URL}/api/local/prompts?${params}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Daemon returned ${res.status}`);
    const json = (await res.json()) as {
      conversations: Array<{ prompts: Array<{ session: Session }> }>;
      has_more: boolean;
    };
    for (const conv of json.conversations) {
      for (const sg of conv.prompts) {
        all.push(sg.session);
      }
    }
    if (!json.has_more) break;
    offset += limit;
  }

  return all;
}

syncRouteRoutes.post("/", async (c) => {
  const config = await getConfig();
  if (!config.auth?.token) {
    return c.json({ ok: false, error: "Not authenticated" }, 401);
  }
  try {
    const start = new Date(Date.now() - 180 * 86400000).toISOString();
    const end = new Date().toISOString();
    const sessions = await fetchAllPrompts(start, end);

    const result = await syncPrompts(config.auth.token, sessions, config);

    if (result.synced > 0) {
      await patchConfig({ lastSyncAt: new Date().toISOString() });
    }

    const ok = result.errors === 0;
    return c.json({ ok, data: result });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});
