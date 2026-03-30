import { Hono } from "hono";
import type { Session } from "@devness/useai-types";
import { readSessionsForRange, readV1Sessions, readV1Milestones } from "@devness/useai-storage";
import type { SessionSeal } from "../lib/stats.js";
import { computeStats, filterSessionsByWindow, filterMilestonesByWindow } from "../lib/stats.js";

export const dashboardRoutes = new Hono();

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

function getTimeWindow(scale: TimeScale, referenceTime: number): { start: number; end: number } {
  const ms = ROLLING_MS[scale];
  if (ms !== undefined) {
    return { start: referenceTime - ms, end: referenceTime };
  }

  const d = new Date(referenceTime);

  if (scale === "day") {
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const end = start + 24 * 60 * 60 * 1000;
    return { start, end };
  }

  if (scale === "week") {
    const dayOfWeek = d.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + mondayOffset);
    const start = monday.getTime();
    const end = start + 7 * 24 * 60 * 60 * 1000;
    return { start, end };
  }

  // month
  const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  return { start, end };
}

// ── Session → SessionSeal conversion ─────────────────────────────────────────
// Mirrors the toSessionSeal / toMilestones from sessions.ts

function toSessionSeal(s: Session) {
  return {
    session_id: s.promptId,
    ...(s.connectionId && { conversation_id: s.connectionId }),
    client: s.client,
    task_type: s.taskType,
    languages: s.languages ?? [],
    files_touched: s.filesTouchedCount ?? 0,
    ...(s.project && { project: s.project }),
    title: s.title,
    ...(s.privateTitle && { private_title: s.privateTitle }),
    ...(s.prompt && { prompt: s.prompt }),
    ...(s.promptImages && { prompt_images: s.promptImages }),
    ...(s.promptImageCount && { prompt_image_count: s.promptImageCount }),
    ...(s.model && { model: s.model }),
    ...(s.evaluation && { evaluation: s.evaluation }),
    started_at: s.startedAt,
    ended_at: s.endedAt,
    duration_seconds: Math.round(s.durationMs / 1000),
    ...(s.activeSegments && { active_segments: s.activeSegments }),
    chain_start_hash: s.prevHash,
    chain_end_hash: s.hash,
    seal_signature: s.signature,
  };
}

function toMilestones(s: Session) {
  return (s.milestones ?? []).map((m) => ({
    id: m.id,
    session_id: s.promptId,
    title: m.title,
    ...(m.privateTitle && { private_title: m.privateTitle }),
    ...(s.project && { project: s.project }),
    category: m.category,
    complexity: m.complexity ?? "medium",
    duration_minutes: Math.round(s.durationMs / 60000),
    languages: s.languages ?? [],
    client: s.client,
    created_at: s.endedAt,
    published: false,
    published_at: null,
    chain_hash: s.hash,
  }));
}

// Normalize v1 milestones to match the dashboard Milestone shape
function normalizeV1Milestone(m: Record<string, unknown>) {
  return {
    id: (m["id"] as string) ?? `v1_${Math.random().toString(36).slice(2)}`,
    session_id: (m["session_id"] as string) ?? "",
    title: (m["title"] as string) ?? "",
    ...((m["private_title"] ?? m["privateTitle"]) ? { private_title: (m["private_title"] ?? m["privateTitle"]) as string } : {}),
    ...((m["project"]) ? { project: m["project"] as string } : {}),
    category: (m["category"] as string) ?? "other",
    complexity: (m["complexity"] as string) ?? "medium",
    duration_minutes: (m["duration_minutes"] as number) ?? 0,
    languages: (m["languages"] as string[]) ?? [],
    client: (m["client"] as string) ?? "unknown",
    created_at: (m["created_at"] as string) ?? new Date().toISOString(),
    published: (m["published"] as boolean) ?? false,
    published_at: (m["published_at"] as string) ?? null,
    chain_hash: (m["chain_hash"] as string) ?? "",
  };
}

// ── Route ────────────────────────────────────────────────────────────────────

dashboardRoutes.get("/", async (c) => {
  // Parse query params
  const scaleParam = c.req.query("scale") ?? "day";
  const scale: TimeScale = VALID_SCALES.has(scaleParam) ? (scaleParam as TimeScale) : "day";

  const timeParam = c.req.query("time");
  const referenceTime = timeParam ? Number(timeParam) : Date.now();
  if (Number.isNaN(referenceTime)) {
    return c.json({ error: "Invalid time parameter" }, 400);
  }

  // Compute time window
  const { start: windowStart, end: windowEnd } = getTimeWindow(scale, referenceTime);

  // Determine how many days of data to read — enough to cover the full window plus buffer
  const windowDays = Math.ceil((windowEnd - windowStart) / 86400000) + 1;
  const days = Math.min(Math.max(windowDays, 7), 90);

  // Read all data sources in parallel
  const [sessions, v1Sessions, v1Milestones] = await Promise.all([
    readSessionsForRange(days),
    readV1Sessions(),
    readV1Milestones(),
  ]);

  // Convert v3 sessions to SessionSeal format
  const allSessions = [...sessions.map(toSessionSeal), ...v1Sessions] as unknown as SessionSeal[];

  // Convert v3 embedded milestones + v1 milestones, then dedup
  const v3Milestones = sessions.flatMap(toMilestones);
  const normalizedV1 = v1Milestones.map(normalizeV1Milestone);

  const seen = new Set<string>();
  const allMilestones = [...v3Milestones, ...normalizedV1].filter((m) => {
    const key = `${m.session_id}::${m.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Filter to the time window
  const filteredSessions = filterSessionsByWindow(allSessions, windowStart, windowEnd);
  const filteredMilestones = filterMilestonesByWindow(allMilestones, windowStart, windowEnd);

  // Compute stats
  const stats = computeStats(filteredSessions, filteredMilestones);

  // Evaluation summary across all sessions with evaluations in the window
  const evaluated = filteredSessions.filter(
    (s) => s.evaluation && typeof s.evaluation === "object",
  );
  const evalSummary = evaluated.length > 0
    ? {
        session_count: evaluated.length,
        prompt_quality: avg(evaluated, (s) => s.evaluation!.prompt_quality),
        context_provided: avg(evaluated, (s) => s.evaluation!.context_provided),
        independence_level: avg(evaluated, (s) => s.evaluation!.independence_level),
        scope_quality: avg(evaluated, (s) => s.evaluation!.scope_quality),
        tools_leveraged: Math.round(avg(evaluated, (s) => s.evaluation!.tools_leveraged)),
        total_iterations: evaluated.reduce((sum, s) => sum + s.evaluation!.iteration_count, 0),
        outcomes: countBy(evaluated, (s) => s.evaluation!.task_outcome),
      }
    : null;

  // Daily summaries — group sessions by local date
  const dailyMap = new Map<string, typeof filteredSessions>();
  for (const s of filteredSessions) {
    const date = toLocalDate(s.started_at);
    const arr = dailyMap.get(date);
    if (arr) arr.push(s);
    else dailyMap.set(date, [s]);
  }

  const dailySummaries = [...dailyMap.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, daySessions]) => {
      const totalSeconds = daySessions.reduce((sum, s) => sum + s.duration_seconds, 0);
      return {
        date,
        sessions: daySessions.length,
        total_hours: totalSeconds / 3600,
        clients: countBy(daySessions, (s) => s.client),
        task_types: countBy(daySessions, (s) => s.task_type),
      };
    });

  // Outside window counts
  let beforeCount = 0;
  let afterCount = 0;
  for (const s of allSessions) {
    if (!s.ended_at || s.duration_seconds <= 0) continue;
    const sEnd = new Date(s.ended_at).getTime();
    const sStart = new Date(s.started_at).getTime();
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

  // Display sessions (with valid ended_at and duration)
  const displaySessions = filteredSessions.filter(
    (s) => !!s.ended_at && s.duration_seconds > 0,
  );

  return c.json({
    window: { start: windowStart, end: windowEnd, scale },
    stats,
    evaluation: evalSummary,
    daily_summaries: dailySummaries,
    session_count: filteredSessions.length,
    milestone_count: filteredMilestones.length,
    display_session_count: displaySessions.length,
    outside_window: { before: beforeCount, after: afterCount },
    complexity: { simple, medium, complex },
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
