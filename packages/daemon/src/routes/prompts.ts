import { Hono } from "hono";
import type { Session } from "@devness/useai-types";
import { readSessionsForDateRange, readV1Sessions } from "@devness/useai-storage";
import {
  groupSessionsWithMilestones,
  groupIntoConversations,
} from "../lib/stats.js";

export const promptsRoutes = new Hono();

// --- Conversion helpers ---

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
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 50)));
  const clientFilter = c.req.query("client") ?? null;
  const languageFilter = c.req.query("language") ?? null;
  const projectFilter = c.req.query("project") ?? null;
  const searchTerm = c.req.query("search") ?? null;

  // Read sessions for the date range
  const [v3Sessions, v1Sessions] = await Promise.all([
    readSessionsForDateRange(start, end),
    readV1Sessions(),
  ]);

  // Combine and filter by ISO string comparison — only show signed sessions
  const allSessions: Session[] = [...v3Sessions, ...v1Sessions];
  const windowFiltered = allSessions
    .filter((s) => s.startedAt <= end && s.endedAt >= start)
    .filter((s) => !!s.hash && !!s.signature);

  // Extract milestones from filtered sessions
  const allMilestones: MilestoneSeal[] = windowFiltered.flatMap(toMilestones);

  // Apply filters
  let filtered = windowFiltered;

  if (clientFilter) {
    filtered = filtered.filter(
      (s) => s.client?.toLowerCase() === clientFilter.toLowerCase(),
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

  // Group sessions with milestones, then into conversations
  const sessionsWithMilestones = groupSessionsWithMilestones(
    filtered,
    allMilestones,
  );
  const conversations = groupIntoConversations(sessionsWithMilestones);

  // Paginate
  const total = conversations.length;
  const paginated = conversations.slice(offset, offset + limit);

  return c.json({
    total,
    conversations: paginated,
    has_more: offset + limit < total,
  });
});
