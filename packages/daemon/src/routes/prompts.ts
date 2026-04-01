import { Hono } from "hono";
import type { Session } from "@devness/useai-types";
import { readSessionsForRange, readV1Sessions } from "@devness/useai-storage";
import {
  groupSessionsWithMilestones,
  groupIntoConversations,
} from "../lib/stats.js";

export const promptsRoutes = new Hono();

// --- Time scale types (server-side subset of dashboard TimeScale) ---

type FeedScale = "1h" | "3h" | "6h" | "12h" | "day" | "week" | "month";

const ROLLING_MS: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "3h": 3 * 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
};

function getTimeWindow(
  scale: FeedScale,
  referenceTime: number,
): { start: number; end: number; days: number } {
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
      start = new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate() + mondayOffset,
      ).getTime();
      end = start + 7 * 86400000;
    } else {
      // month
      start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    }
  }

  const days = Math.min(
    32,
    Math.max(2, Math.ceil((Date.now() - start) / 86400000) + 1),
  );
  return { start, end, days };
}

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

// --- Scales ---

const VALID_SCALES = new Set<string>([
  "1h",
  "3h",
  "6h",
  "12h",
  "day",
  "week",
  "month",
]);

// --- Filter helpers ---

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

promptsRoutes.get("/", async (c) => {
  const scaleParam = c.req.query("scale") ?? "day";
  const scale: FeedScale = VALID_SCALES.has(scaleParam)
    ? (scaleParam as FeedScale)
    : "day";
  //Always in ms
  const referenceTime = c.req.query("time")
    ? Number(c.req.query("time"))
    : Date.now();
  const offset = Math.max(0, Number(c.req.query("offset") ?? 0));
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 50)));
  const clientFilter = c.req.query("client") ?? null;
  const languageFilter = c.req.query("language") ?? null;
  const projectFilter = c.req.query("project") ?? null;
  const searchTerm = c.req.query("search") ?? null;

  // 1. Compute time window and how many days of files to read
  const window = getTimeWindow(scale, referenceTime);

  // 2. Read sessions (v3 + v1)
  const [v3Sessions, v1Sessions] = await Promise.all([
    readSessionsForRange(window.days),
    readV1Sessions(),
  ]);

  // 3. Combine and filter by time window
  const allSessions: Session[] = [...v3Sessions, ...v1Sessions];
  const windowFiltered = allSessions.filter((s) => {
    const sStart = new Date(s.startedAt).getTime();
    const sEnd = new Date(s.endedAt).getTime();
    return sStart <= window.end && sEnd >= window.start;
  });

  // 4. Extract milestones from filtered sessions
  const allMilestones: MilestoneSeal[] = windowFiltered.flatMap(toMilestones);

  // 5. Filter by client/language/project/search
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

  // 6. Group sessions with milestones (attach milestones to their sessions)
  const sessionsWithMilestones = groupSessionsWithMilestones(
    filtered,
    allMilestones,
  );

  // 7. Group into conversations (already sorted by most recent, includes aggregate evals)
  const conversations = groupIntoConversations(sessionsWithMilestones);

  // 8. Paginate (offset + limit)
  const total = conversations.length;
  const paginated = conversations.slice(offset, offset + limit);

  return c.json({
    total,
    conversations: paginated,
    has_more: offset + limit < total,
  });
});
