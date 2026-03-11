import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { sessionsRoutes } from "./routes/sessions.js";
import { milestonesRoutes } from "./routes/milestones.js";
import { statsRoutes } from "./routes/stats.js";
import { configRoutes } from "./routes/config.js";
import { healthRoutes } from "./routes/health.js";
import { mcpRoutes } from "./routes/mcp.js";
import { authRoutes } from "./routes/auth.js";
import { syncRouteRoutes } from "./routes/sync-route.js";
import { updateRoutes } from "./routes/update.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp(): Hono {
  const app = new Hono();

  app.use("/*", cors({ origin: "*" }));

  app.route("/mcp", mcpRoutes);
  app.route("/api/local/sessions", sessionsRoutes);
  app.route("/api/local/milestones", milestonesRoutes);
  app.route("/api/local/stats", statsRoutes);
  app.route("/api/local/config", configRoutes);
  app.route("/api/local/auth", authRoutes);
  app.route("/api/local/sync", syncRouteRoutes);
  app.route("/api/local/update-check", updateRoutes);
  app.route("/", healthRoutes);

  // DELETE /api/local/conversations/:id — deletes all sessions sharing a conversation_id
  // In v3, conversation_id is not stored, so we just return success (optimistic delete handles UI)
  app.delete("/api/local/conversations/:id", async (c) => {
    const conversationId = c.req.param("id");
    // v3 sessions don't have conversation_id — no-op, optimistic delete already updated the UI
    return c.json({
      deleted: true,
      conversation_id: conversationId,
      sessions_removed: 0,
      milestones_removed: 0,
    });
  });

  // Serve dashboard SPA from the built dist directory
  const dashboardDir =
    process.env["USEAI_DASHBOARD_DIR"] ??
    resolve(__dirname, "../../dashboard/dist");

  app.use(
    "/dashboard/*",
    serveStatic({
      root: dashboardDir,
      rewriteRequestPath: (path) => path.replace(/^\/dashboard/, ""),
    }),
  );

  // Serve favicon from dashboard dist at root path
  app.get("/favicon.svg", serveStatic({
    root: dashboardDir,
    rewriteRequestPath: () => "/favicon.svg",
  }));

  // SPA fallback: serve index.html for any unmatched /dashboard route
  app.get("/dashboard", async (c) => {
    return c.redirect("/dashboard/");
  });

  return app;
}
