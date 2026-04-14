import { Hono } from "hono";
import type { Session } from "@devness/useai-types";
import {
  readSessionsForDateRange,
  readV1Sessions,
} from "@devness/useai-storage";
import {
  groupPromptsWithMilestones,
  groupIntoConversations,
} from "../lib/stats.js";

export const promptsRoutes = new Hono();

// --- Conversion helpers ---

function toCamelEvaluation(ev: NonNullable<Session["evaluation"]>) {
  return {
    promptQuality: ev.prompt_quality,
    ...(ev.prompt_quality_reason && { promptQualityReason: ev.prompt_quality_reason }),
    ...(ev.prompt_quality_ideal && { promptQualityIdeal: ev.prompt_quality_ideal }),
    contextProvided: ev.context_provided,
    ...(ev.context_provided_reason && { contextProvidedReason: ev.context_provided_reason }),
    ...(ev.context_provided_ideal && { contextProvidedIdeal: ev.context_provided_ideal }),
    scopeQuality: ev.scope_quality,
    ...(ev.scope_quality_reason && { scopeQualityReason: ev.scope_quality_reason }),
    ...(ev.scope_quality_ideal && { scopeQualityIdeal: ev.scope_quality_ideal }),
    independenceLevel: ev.independence_level,
    ...(ev.independence_level_reason && { independenceLevelReason: ev.independence_level_reason }),
    ...(ev.independence_level_ideal && { independenceLevelIdeal: ev.independence_level_ideal }),
    taskOutcome: ev.task_outcome,
    ...(ev.task_outcome_reason && { taskOutcomeReason: ev.task_outcome_reason }),
    ...(ev.task_outcome_ideal && { taskOutcomeIdeal: ev.task_outcome_ideal }),
    iterationCount: ev.iteration_count,
    toolsLeveraged: ev.tools_leveraged,
  };
}

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

type MilestoneSeal = ReturnType<typeof toMilestones>[number];

function matchesSearch(session: Session, term: string): boolean {
  const lower = term.toLowerCase();
  if (session.title?.toLowerCase().includes(lower)) return true;
  if (session.privateTitle?.toLowerCase().includes(lower)) return true;
  if (session.taskType?.toLowerCase().includes(lower)) return true;
  if (session.languages?.some((l: string) => l.toLowerCase().includes(lower)))
    return true;
  if (session.project?.toLowerCase().includes(lower)) return true;
  if (session.client?.toLowerCase().includes(lower)) return true;
  return false;
}

// --- Route ---

promptsRoutes.get("/", async (c) => {
  const start = c.req.query("start");
  const end = c.req.query("end");

  if (!start || !end || !start.includes("Z") || !end.includes("Z")) {
    return c.json(
      { error: "start and end query params required (ISO string)" },
      400,
    );
  }

  const offset = Math.max(0, Number(c.req.query("offset") ?? 0));
  const limit = Math.min(50, Math.max(50, Number(c.req.query("limit") ?? 50)));
  const toolFilter = c.req.query("tool") ?? null;
  const languageFilter = c.req.query("language") ?? null;
  const projectFilter = c.req.query("project") ?? null;
  const searchTerm = c.req.query("search") ?? null;

  // Read sessions for the date range, and v1 sessions are converted to the structure of latest version.
  const [v3Sessions, v1Sessions] = await Promise.all([
    readSessionsForDateRange(start, end),
    readV1Sessions(),
  ]);

  // Combine and filter by ISO string comparison — only show signed sessions
  const allSessions: Session[] = [...v3Sessions, ...v1Sessions];
  const windowFiltered = allSessions
    .filter((s) => s.startedAt <= end && s.endedAt >= start)
    .filter((s) => !!s.endedAt && s.durationMs > 0)
    .filter((s) => !!s.hash && !!s.signature);

  // Apply filters
  let filtered = windowFiltered;

  if (toolFilter) {
    filtered = filtered.filter(
      (s) => s.client?.toLowerCase() === toolFilter.toLowerCase(),
    );
  }

  if (languageFilter) {
    const lang = languageFilter.toLowerCase();
    filtered = filtered.filter((s) =>
      s.languages?.some((l: string) => l.toLowerCase() === lang),
    );
  }

  if (projectFilter) {
    filtered = filtered.filter(
      (s) => s.project?.toLowerCase() === projectFilter.toLowerCase(),
    );
  }

  if (searchTerm) {
    filtered = filtered.filter((s) => matchesSearch(s, searchTerm));
  }

  // Convert evaluation to camelCase for API response
  const camelFiltered = filtered.map((s) => ({
    ...s,
    evaluation: s.evaluation ? toCamelEvaluation(s.evaluation) : undefined,
  })) as unknown as Session[];

  // Restructure milestones to latest useai version.
  const enrichedMilestones: MilestoneSeal[] = camelFiltered.flatMap(toMilestones);

  //Restructured into {prompts, milestones} as expected by the dashboard for separation of concerns.
  const promptsWithMilestones = groupPromptsWithMilestones(
    camelFiltered,
    enrichedMilestones,
  );

  const conversations = groupIntoConversations(promptsWithMilestones);

  // Paginate
  const total = conversations.length;
  const paginated = conversations.slice(offset, offset + limit);

  return c.json({
    total,
    conversations: paginated,
    hasMore: offset + limit < total,
  });
});
