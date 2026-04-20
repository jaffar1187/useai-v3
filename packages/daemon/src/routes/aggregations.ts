import { Hono } from "hono";
import type { Session } from "@devness/useai-types";
import {
  parseTimeRange,
  getFilteredSessions,
  toEnrichedMilestones,
} from "../lib/sessions.js";
import { computeStats } from "../lib/stats.js";

export const aggregationsRoutes = new Hono();

// ── Projection helpers ───────────────────────────────────────────────────────

function toSessionSummary(s: Session) {
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
    ...(s.activeSegments && { activeSegments: s.activeSegments }),
  };
}



// ── Helpers ──────────────────────────────────────────────────────────────────

function avg<T>(items: T[], fn: (item: T) => number): number {
  if (items.length === 0) return 0;
  return (
    Math.round((items.reduce((s, i) => s + fn(i), 0) / items.length) * 10) / 10
  );
}

function countBy<T>(
  items: T[],
  fn: (item: T) => string,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    const key = fn(item);
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

// ── Route ────────────────────────────────────────────────────────────────────

aggregationsRoutes.get("/", async (c) => {
  const range = parseTimeRange(c.req.query("start"), c.req.query("end"));
  if (!range) {
    return c.json(
      { error: "start and end query params required (ISO string)" },
      400,
    );
  }

  const filteredSessions = await getFilteredSessions(range.start, range.end);

  // Restructure milestones to a common format.
  const milestones = filteredSessions.flatMap(toEnrichedMilestones);

  // Compute stats
  const stats = computeStats(filteredSessions, milestones);

  // Evaluation summary
  const evaluated = filteredSessions.filter(
    (s) => s.evaluation && typeof s.evaluation === "object",
  );
  const evalSummary =
    evaluated.length > 0
      ? {
          sessionCount: evaluated.length,
          promptQuality: avg(evaluated, (s) => s.evaluation!.prompt_quality),
          contextProvided: avg(
            evaluated,
            (s) => s.evaluation!.context_provided,
          ),
          independenceLevel: avg(
            evaluated,
            (s) => s.evaluation!.independence_level,
          ),
          scopeQuality: avg(evaluated, (s) => s.evaluation!.scope_quality),
          toolsLeveraged: Math.round(
            avg(evaluated, (s) => s.evaluation!.tools_leveraged),
          ),
          totalIterations: evaluated.reduce(
            (sum, s) => sum + s.evaluation!.iteration_count,
            0,
          ),
          outcomes: countBy(evaluated, (s) => s.evaluation!.task_outcome),
        }
      : null;

  // Complexity distribution
  let simple = 0,
    medium = 0,
    complex = 0;
  for (const m of milestones) {
    const comp =
      ((m as unknown as Record<string, unknown>)["complexity"] as string) ??
      "medium";
    if (comp === "simple") simple++;
    else if (comp === "medium") medium++;
    else if (comp === "complex") complex++;
  }

  return c.json({
    window: { start: range.start, end: range.end },
    stats,
    evaluation: evalSummary,
    sessionCount: filteredSessions.length,
    milestoneCount: milestones.length,
    complexity: { simple, medium, complex },
    sessions: filteredSessions.map(toSessionSummary),
    milestones,
  });
});
