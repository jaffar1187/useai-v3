import { Hono } from "hono";
import { getConfig, patchConfig } from "@devness/useai-storage";

export const configRoutes = new Hono();

configRoutes.get("/", async (c) => {
  const config = await getConfig();
  return c.json({ ok: true, data: { config } });
});

configRoutes.patch("/", async (c) => {
  const patch = await c.req.json();
  const updated = await patchConfig(patch);
  return c.json({ ok: true, data: { config: updated } });
});
