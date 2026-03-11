import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { sessionsRoutes } from "./routes/sessions.js";
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
  app.route("/api/local/stats", statsRoutes);
  app.route("/api/local/config", configRoutes);
  app.route("/api/local/auth", authRoutes);
  app.route("/api/local/sync", syncRouteRoutes);
  app.route("/api/local/update-check", updateRoutes);
  app.route("/", healthRoutes);

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

  // SPA fallback: serve index.html for any unmatched /dashboard route
  app.get("/dashboard", async (c) => {
    return c.redirect("/dashboard/");
  });

  return app;
}
