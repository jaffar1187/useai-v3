import { Hono } from "hono";
import type { Session } from "@devness/useai-types";
import { readSessionsForRange, readV1Sessions, readV1Milestones } from "@devness/useai-storage";
import type { SessionSeal as StatsSessionSeal } from "../lib/stats.js";
import {
  filterSessionsByWindow,
  groupSessionsWithMilestones,
  groupIntoConversations,
} from "../lib/stats.js";

export const feedRoutes = new Hono();

// --- Time scale types (server-side subset of dashboard TimeScale) ---

type FeedScale = "1h" | "3h" | "6h" | "12h" | "day" | "week" | "month";

const ROLLING_MS: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "3h": 3 * 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
};

function getTimeWindow(scale: FeedScale, referenceTime: number): { start: number; end: number } {
  const ms = ROLLING_MS[scale];
  if (ms !== undefined) {
    return { start: referenceTime - ms, end: referenceTime };
  }

  const d = new Date(referenceTime);

  if (scale === "day") {
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return { start, end: start + 24 * 60 * 60 * 1000 };
  }

  if (scale === "week") {
    const dayOfWeek = d.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + mondayOffset);
    const start = monday.getTime();
    return { start, end: start + 7 * 24 * 60 * 60 * 1000 };
  }

  // month
  const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  return { start, end };
}

// --- Conversion helpers (same as sessions.ts) ---

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

// --- Scales to read-range days mapping ---

const SCALE_TO_DAYS: Record<FeedScale, number> = {
  "1h": 1,
  "3h": 1,
  "6h": 1,
  "12h": 1,
  "day": 2,
  "week": 8,
  "month": 31,
};

const VALID_SCALES = new Set<string>(["1h", "3h", "6h", "12h", "day", "week", "month"]);

// --- Filter helpers ---

type MilestoneSeal = ReturnType<typeof toMilestones>[number];

function matchesSearch(session: StatsSessionSeal, term: string): boolean {
  const lower = term.toLowerCase();
  if (session.title?.toLowerCase().includes(lower)) return true;
  if (session.private_title?.toLowerCase().includes(lower)) return true;
  if (session.task_type?.toLowerCase().includes(lower)) return true;
  if (session.languages?.some((l: string) => l.toLowerCase().includes(lower))) return true;
  if (session.project?.toLowerCase().includes(lower)) return true;
  if (session.client?.toLowerCase().includes(lower)) return true;
  return false;
}

// GET /api/local/sessions/feed
feedRoutes.get("/", async (c) => {
  const scaleParam = c.req.query("scale") ?? "day";
  const scale: FeedScale = VALID_SCALES.has(scaleParam) ? (scaleParam as FeedScale) : "day";
  const referenceTime = c.req.query("time") ? Number(c.req.query("time")) : Date.now();
  const offset = Math.max(0, Number(c.req.query("offset") ?? 0));
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 50)));
  const clientFilter = c.req.query("client") ?? null;
  const languageFilter = c.req.query("language") ?? null;
  const projectFilter = c.req.query("project") ?? null;
  const searchTerm = c.req.query("search") ?? null;

  // 1. Compute time window
  const window = getTimeWindow(scale, referenceTime);
  const readDays = SCALE_TO_DAYS[scale];

  // 2. Read sessions (v3 + v1) and milestones (v1)
  const [v3Sessions, v1Sessions, v1Milestones] = await Promise.all([
    readSessionsForRange(readDays),
    readV1Sessions(),
    readV1Milestones(),
  ]);

  // 3. Convert to SessionSeal format
  const allSeals = [
    ...v3Sessions.map(toSessionSeal),
    ...v1Sessions,
  ] as unknown as StatsSessionSeal[];

  // Extract all milestones (v3 embedded + v1 standalone)
  const v3Milestones: MilestoneSeal[] = v3Sessions.flatMap(toMilestones);
  const normalizedV1 = (v1Milestones as Record<string, unknown>[]).map(normalizeV1Milestone);
  const allMilestones = [...v3Milestones, ...normalizedV1];

  // 4. Filter by time window
  const windowFiltered = filterSessionsByWindow(allSeals, window.start, window.end);

  // 5. Filter by client/language/project/search
  let filtered = windowFiltered;

  if (clientFilter) {
    filtered = filtered.filter((s) => s.client?.toLowerCase() === clientFilter.toLowerCase());
  }

  if (languageFilter) {
    const lang = languageFilter.toLowerCase();
    filtered = filtered.filter((s) =>
      s.languages?.some((l: string) => l.toLowerCase() === lang),
    );
  }

  if (projectFilter) {
    filtered = filtered.filter((s) => s.project?.toLowerCase() === projectFilter.toLowerCase());
  }

  if (searchTerm) {
    filtered = filtered.filter((s) => matchesSearch(s, searchTerm));
  }

  // 6. Group sessions with milestones (attach milestones to their sessions)
  const sessionsWithMilestones = groupSessionsWithMilestones(filtered, allMilestones);

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
