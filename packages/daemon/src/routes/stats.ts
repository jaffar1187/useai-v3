import { Hono } from "hono";
import { readSessionsForRange } from "@devness/useai-storage";
import type { StatsResponse } from "@devness/useai-types";

export const statsRoutes = new Hono();

statsRoutes.get("/", async (c) => {
  const sessions = await readSessionsForRange(30);

  const stats: StatsResponse = {
    totalSessions: sessions.length,
    totalDurationMs: sessions.reduce((sum, s) => sum + s.durationMs, 0),
    currentStreak: 0,
    longestStreak: 0,
    averageScore:
      sessions.length > 0
        ? sessions.reduce((sum, s) => sum + (s.score?.overall ?? 0), 0) / sessions.length
        : 0,
    sessionsByClient: groupBy(sessions, (s) => s.client),
    sessionsByTaskType: groupBy(sessions, (s) => s.taskType),
  };

  return c.json({ ok: true, data: stats });
});

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    const key = keyFn(item);
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}
