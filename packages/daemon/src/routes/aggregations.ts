import { Hono } from "hono";
import type { Session } from "@devness/useai-types";
import { readSessionsForDateRange, readV1Sessions } from "@devness/useai-storage";
import { computeStats } from "../lib/stats.js";

export const aggregationsRoutes = new Hono();

// ── Milestone extraction ──────────────────────────────────────────────────────

function toMilestones(s: Session) {
  return (s.milestones ?? []).map((m) => ({
    id: m.id,
    promptId: s.promptId,
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function avg<T>(items: T[], fn: (item: T) => number): number {
  if (items.length === 0) return 0;
  return Math.round((items.reduce((s, i) => s + fn(i), 0) / items.length) * 10) / 10;
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

// ── Route ────────────────────────────────────────────────────────────────────

aggregationsRoutes.get("/", async (c) => {
  const start = c.req.query("start");
  const end = c.req.query("end");

  if (!start || !end || !start.includes("Z") || !end.includes("Z")) {
    return c.json({ error: "start and end query params required (ISO string)" }, 400);
  }

  // Read sessions for the date range
  const [sessions, v1Sessions] = await Promise.all([
    readSessionsForDateRange(start, end),
    readV1Sessions(),
  ]);

  const allSessions: Session[] = [...sessions, ...v1Sessions];

  // Filter by ISO string comparison — only show signed sessions
  const filteredSessions = allSessions
    .filter((s) => s.startedAt <= end && s.endedAt >= start)
    .filter((s) => !!s.endedAt && s.durationMs > 0)
    .filter((s) => !!s.hash && !!s.signature);

  // Extract milestones from filtered sessions
  const filteredMilestones = filteredSessions.flatMap(toMilestones);

  // Dedup milestones
  const seen = new Set<string>();
  const dedupedMilestones = filteredMilestones.filter((m) => {
    const key = `${m.promptId}::${m.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Compute stats
  const stats = computeStats(filteredSessions, dedupedMilestones);

  // Evaluation summary
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

  // Daily summaries
  const dailyMap = new Map<string, Session[]>();
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
    if (s.endedAt < start) beforeCount++;
    else if (s.startedAt > end) afterCount++;
  }

  // Complexity distribution
  let simple = 0, medium = 0, complex = 0;
  for (const m of dedupedMilestones) {
    const comp = (m as unknown as Record<string, unknown>)["complexity"] as string ?? "medium";
    if (comp === "simple") simple++;
    else if (comp === "medium") medium++;
    else if (comp === "complex") complex++;
  }

  // Display sessions
  const displaySessions = filteredSessions;

  return c.json({
    window: { start, end },
    stats,
    evaluation: evalSummary,
    dailySummaries,
    sessionCount: filteredSessions.length,
    milestoneCount: dedupedMilestones.length,
    displaySessionCount: displaySessions.length,
    outsideWindow: { before: beforeCount, after: afterCount },
    complexity: { simple, medium, complex },
    filteredSessions: displaySessions.map(toFilteredSession),
    filteredMilestones: dedupedMilestones,
    allSessionsLight: filteredSessions.map(toLightSession),
  });
});
