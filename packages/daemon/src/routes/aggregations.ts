import { Hono } from "hono";
import type { Session } from "@devness/useai-types";
import { readSessionsForRange, readV1Sessions } from "@devness/useai-storage";
import { computeStats, filterSessionsByWindow } from "../lib/stats.js";

export const aggregationsRoutes = new Hono();

// ── Time scale types & window computation ────────────────────────────────────
// Inlined from dashboard time-travel/types.ts to avoid cross-package dependency

type TimeScale = "1h" | "3h" | "6h" | "12h" | "24h" | "day" | "7d" | "week" | "30d" | "month";

const ROLLING_MS: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "3h": 3 * 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const VALID_SCALES = new Set<string>([
  "1h", "3h", "6h", "12h", "24h", "day", "7d", "week", "30d", "month",
]);

function getTimeWindow(scale: TimeScale, referenceTime: number): { start: number; end: number; days: number } {
  let start: number;
  let end: number;

  const ms = ROLLING_MS[scale];
  if (ms !== undefined) {
    start = referenceTime - ms;
    end = referenceTime;
  } else {
    const d = new Date(referenceTime);

    if (scale === "day") {
      start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      end = start + 86400000;
    } else if (scale === "week") {
      const dayOfWeek = d.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      start = new Date(d.getFullYear(), d.getMonth(), d.getDate() + mondayOffset).getTime();
      end = start + 7 * 86400000;
    } else {
      // month
      start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    }
  }

  const days = Math.min(32, Math.max(2, Math.ceil((Date.now() - start) / 86400000) + 1));
  return { start, end, days };
}

// ── Session → SessionSeal conversion ─────────────────────────────────────────

function toMilestones(s: Session) {
  return (s.milestones ?? []).map((m) => ({
    id: m.id,
    sessionId: s.promptId,
    title: m.title,
    ...(m.privateTitle && { privateTitle: m.privateTitle }),
    ...(s.project && { project: s.project }),
    category: m.category,
    complexity: m.complexity ?? "medium",
    durationMinutes: Math.round(s.durationMs / 60000),
    languages: s.languages ?? [],
    client: s.client,
    createdAt: s.endedAt,
    published: false,
    publishedAt: null,
    chainHash: s.hash,
  }));
}

// ── Projection helpers ───────────────────────────────────────────────────────

function toFilteredSession(s: Session) {
  return {
    promptId: s.promptId,
    client: s.client,
    taskType: s.taskType,
    title: s.title,
    ...(s.privateTitle && { privateTitle: s.privateTitle }),
    ...(s.project && { project: s.project }),
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    durationMs: s.durationMs,
    languages: s.languages ?? [],
    ...(s.evaluation && { evaluation: s.evaluation }),
    ...(s.activeSegments && { activeSegments: s.activeSegments }),
    ...(s.connectionId && { connectionId: s.connectionId }),
    filesTouchedCount: s.filesTouchedCount ?? 0,
    ...(s.model && { model: s.model }),
  };
}

function toLightSession(s: Session) {
  return {
    promptId: s.promptId,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    durationMs: s.durationMs,
    ...(s.activeSegments && { activeSegments: s.activeSegments }),
    client: s.client,
    languages: s.languages ?? [],
  };
}

// ── Route ────────────────────────────────────────────────────────────────────

aggregationsRoutes.get("/", async (c) => {
  // Parse query params
  const scaleParam = c.req.query("scale") ?? "day";
  const scale: TimeScale = VALID_SCALES.has(scaleParam) ? (scaleParam as TimeScale) : "day";

  const timeParam = c.req.query("time");
  const referenceTime = timeParam ? Number(timeParam) : Date.now();
  if (Number.isNaN(referenceTime)) {
    return c.json({ error: "Invalid time parameter" }, 400);
  }

  // Compute time window and how many days of files to read
  const { start: windowStart, end: windowEnd, days } = getTimeWindow(scale, referenceTime);

  // Read all data sources in parallel
  const [sessions, v1Sessions] = await Promise.all([
    readSessionsForRange(days),
    readV1Sessions(),
  ]);

  // Combine v3 + v1 sessions (v1 already returns Session shape)
  const allSessions: Session[] = [...sessions, ...v1Sessions];

  // Filter sessions to the time window first
  const filteredSessions = filterSessionsByWindow(allSessions, windowStart, windowEnd)
    .filter((s) => !!s.endedAt && s.durationMs > 0);

  // Extract milestones from filtered sessions
  const v3Milestones = filteredSessions.flatMap(toMilestones);
  // Dedup milestones
  const seen = new Set<string>();
  const filteredMilestones = v3Milestones.filter((m) => {
    const key = `${m.sessionId}::${m.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Compute stats
  const stats = computeStats(filteredSessions, filteredMilestones);

  // Evaluation summary across all sessions with evaluations in the window
  const evaluated = filteredSessions.filter(
    (s) => s.evaluation && typeof s.evaluation === "object",
  );
  const evalSummary = evaluated.length > 0
    ? {
        sessionCount: evaluated.length,
        promptQuality: avg(evaluated, (s) => s.evaluation!.prompt_quality),
        contextProvided: avg(evaluated, (s) => s.evaluation!.context_provided),
        independenceLevel: avg(evaluated, (s) => s.evaluation!.independence_level),
        scopeQuality: avg(evaluated, (s) => s.evaluation!.scope_quality),
        toolsLeveraged: Math.round(avg(evaluated, (s) => s.evaluation!.tools_leveraged)),
        totalIterations: evaluated.reduce((sum, s) => sum + s.evaluation!.iteration_count, 0),
        outcomes: countBy(evaluated, (s) => s.evaluation!.task_outcome),
      }
    : null;

  // Daily summaries — group sessions by local date
  const dailyMap = new Map<string, typeof filteredSessions>();
  for (const s of filteredSessions) {
    const date = toLocalDate(s.startedAt);
    const arr = dailyMap.get(date);
    if (arr) arr.push(s);
    else dailyMap.set(date, [s]);
  }

  const dailySummaries = [...dailyMap.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, daySessions]) => {
      const totalSeconds = daySessions.reduce((sum, s) => sum + Math.round(s.durationMs / 1000), 0);
      return {
        date,
        sessions: daySessions.length,
        totalHours: totalSeconds / 3600,
        clients: countBy(daySessions, (s) => s.client),
        taskTypes: countBy(daySessions, (s) => s.taskType),
      };
    });

  // Outside window counts
  let beforeCount = 0;
  let afterCount = 0;
  for (const s of allSessions) {
    if (!s.endedAt || s.durationMs <= 0) continue;
    const sEnd = new Date(s.endedAt).getTime();
    const sStart = new Date(s.startedAt).getTime();
    if (sEnd < windowStart) beforeCount++;
    else if (sStart > windowEnd) afterCount++;
  }

  // Complexity distribution
  let simple = 0, medium = 0, complex = 0;
  for (const m of filteredMilestones) {
    const c = (m as unknown as Record<string, unknown>)["complexity"] as string ?? "medium";
    if (c === "simple") simple++;
    else if (c === "medium") medium++;
    else if (c === "complex") complex++;
  }

  // Display sessions (with valid endedAt and duration)
  const displaySessions = filteredSessions.filter(
    (s) => !!s.endedAt && s.durationMs > 0,
  );

  return c.json({
    window: { start: windowStart, end: windowEnd, scale },
    stats,
    evaluation: evalSummary,
    dailySummaries,
    sessionCount: filteredSessions.length,
    milestoneCount: filteredMilestones.length,
    displaySessionCount: displaySessions.length,
    outsideWindow: { before: beforeCount, after: afterCount },
    complexity: { simple, medium, complex },
    filteredSessions: displaySessions.map(toFilteredSession),
    filteredMilestones,
    allSessionsLight: allSessions.map(toLightSession),
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function avg<T>(items: T[], fn: (item: T) => number): number {
  if (items.length === 0) return 0;
  const sum = items.reduce((s, item) => s + fn(item), 0);
  return Math.round((sum / items.length) * 10) / 10;
}

function countBy<T>(items: T[], fn: (item: T) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    const key = fn(item);
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

function toLocalDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
