import type { Session, SessionEvaluation, UseaiConfig } from "@devness/useai-types";
const DAEMON_URL = "http://127.0.0.1:19200";
import { apiFetch } from "./api-client.js";
import type { SanitizedSession, SyncPayload, SyncResult } from "./types.js";

const CLIENT_VERSION = "3.0.0";

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

function sanitizeEvaluation(
  evaluation: SessionEvaluation,
  includeEvaluationReasons: UseaiConfig["sync"]["includeEvaluationReasons"],
): SessionEvaluation {
  if (includeEvaluationReasons === "all") return evaluation;

  if (includeEvaluationReasons === "none") {
    // Strip all *_reason and *_ideal fields
    const {
      prompt_quality_reason: _pqr, prompt_quality_ideal: _pqi,
      context_provided_reason: _cpr, context_provided_ideal: _cpi,
      task_outcome_reason: _tor, task_outcome_ideal: _toi,
      independence_level_reason: _ilr, independence_level_ideal: _ili,
      scope_quality_reason: _sqr, scope_quality_ideal: _sqi,
      ...rest
    } = evaluation;
    return rest;
  }

  // "below_perfect" — keep reasons only for scores below 5
  const result = { ...evaluation };
  if (result.prompt_quality === 5) { delete result.prompt_quality_reason; delete result.prompt_quality_ideal; }
  if (result.context_provided === 5) { delete result.context_provided_reason; delete result.context_provided_ideal; }
  if (result.independence_level === 5) { delete result.independence_level_reason; delete result.independence_level_ideal; }
  if (result.scope_quality === 5) { delete result.scope_quality_reason; delete result.scope_quality_ideal; }
  // task_outcome is a string not a number — always keep its reason
  return result;
}

function sanitizeSession(
  session: Session,
  sync: UseaiConfig["sync"],
): SanitizedSession {
  // Always strip prompt and promptImages (stays local)
  const { prompt: _prompt, promptImages: _images, ...withoutPrompt } = session;

  // Strip private details if includePrivateDetails is false
  if (!sync.includePrivateDetails) {
    delete withoutPrompt.privateTitle;
    delete withoutPrompt.project;
  }

  // Strip milestones if includeMilestones is false
  if (!sync.includeMilestones) {
    (withoutPrompt as Record<string, unknown>)["milestones"] = undefined;
  }

  // Strip evaluation if includeEvaluation is false
  if (!sync.includeEvaluation || !withoutPrompt.evaluation) {
    const { evaluation: _eval, ...withoutEval } = withoutPrompt;
    return withoutEval;
  }

  // Sanitize evaluation reasons based on setting
  return {
    ...withoutPrompt,
    evaluation: sanitizeEvaluation(
      withoutPrompt.evaluation,
      sync.includeEvaluationReasons,
    ),
  };
}

// ---------------------------------------------------------------------------
// Group by date
// ---------------------------------------------------------------------------

function groupByDate(sessions: SanitizedSession[]): Map<string, SanitizedSession[]> {
  const byDate = new Map<string, SanitizedSession[]>();
  for (const s of sessions) {
    const date = s.startedAt.slice(0, 10);
    const arr = byDate.get(date);
    if (arr) arr.push(s);
    else byDate.set(date, [s]);
  }
  return byDate;
}

// ---------------------------------------------------------------------------
// Daemon aggregations response shape (subset we use)
// ---------------------------------------------------------------------------

interface DaemonStats {
  totalHours: number;
  coveredHours: number;
  aiMultiplier: number;
  currentStreak: number;
  byAiToolDuration: Record<string, number>;
  byLanguageAiTime: Record<string, number>;
  byTaskTypeAiTime: Record<string, number>;
}

interface DaemonAggregationsResponse {
  stats: DaemonStats;
  sessionCount: number;
}

/** Fetch aggregated stats for a single date from the daemon. */
async function fetchDaemonAggregations(date: string): Promise<DaemonAggregationsResponse | null> {
  const start = `${date}T00:00:00.000Z`;
  const end = `${date}T23:59:59.999Z`;
  const params = new URLSearchParams({ start, end });

  try {
    const res = await fetch(`${DAEMON_URL}/api/local/aggregations?${params}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return (await res.json()) as DaemonAggregationsResponse;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fetch sessions from daemon
// ---------------------------------------------------------------------------

async function fetchSessionsFromDaemon(days: number): Promise<Session[]> {
  const start = new Date(Date.now() - days * 86400000).toISOString();
  const end = new Date().toISOString();
  const all: Session[] = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const params = new URLSearchParams({ start, end, offset: String(offset), limit: String(limit) });
    const res = await fetch(`${DAEMON_URL}/api/local/prompts?${params}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) break;
    const json = await res.json() as {
      conversations: Array<{ prompts: Array<{ prompt: Session }> }>;
      hasMore: boolean;
    };
    for (const conv of json.conversations) {
      for (const pg of conv.prompts) {
        all.push(pg.prompt);
      }
    }
    if (!json.hasMore) break;
    offset += limit;
  }

  return all;
}

// ---------------------------------------------------------------------------
// Main sync
// ---------------------------------------------------------------------------

export async function syncPrompts(
  token: string,
  config: UseaiConfig,
  days?: number,
): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, skipped: 0, errors: 0 };

  const sessions = await fetchSessionsFromDaemon(days ?? 180);

  if (sessions.length === 0) return result;

  // Sanitize (strip private data based on user's privacy settings)
  const sanitized = sessions.map((s) => sanitizeSession(s, config.sync));

  // Group by date for per-day cloud sync
  const byDate = groupByDate(sanitized);

  for (const [date, daySessions] of byDate) {
    // 5. Fetch pre-computed stats from daemon aggregations endpoint
    const agg = await fetchDaemonAggregations(date);

    let totalSeconds: number;
    let userTimeSeconds: number;
    let aiTimeSeconds: number;
    let multiplier: number;
    let streakDays: number;
    let clients: Record<string, number>;
    let taskTypes: Record<string, number>;
    let languages: Record<string, number>;

    if (agg) {
      // Use daemon-computed stats — no need to recompute
      totalSeconds = Math.round(agg.stats.totalHours * 3600);
      userTimeSeconds = Math.round(agg.stats.coveredHours * 3600);
      aiTimeSeconds = totalSeconds;
      multiplier = agg.stats.aiMultiplier;
      streakDays = agg.stats.currentStreak;
      // Convert hours → seconds for per-tool/language/taskType breakdowns
      clients = Object.fromEntries(
        Object.entries(agg.stats.byAiToolDuration).map(([k, h]) => [k, Math.round(h * 3600)]),
      );
      taskTypes = Object.fromEntries(
        Object.entries(agg.stats.byTaskTypeAiTime).map(([k, h]) => [k, Math.round(h * 3600)]),
      );
      languages = Object.fromEntries(
        Object.entries(agg.stats.byLanguageAiTime).map(([k, h]) => [k, Math.round(h * 3600)]),
      );
    } else {
      // Fallback: compute from sessions if daemon is unavailable
      totalSeconds = 0;
      clients = {};
      taskTypes = {};
      languages = {};
      for (const s of daySessions) {
        const secs = Math.round(s.durationMs / 1000);
        totalSeconds += secs;
        clients[s.client] = (clients[s.client] ?? 0) + secs;
        taskTypes[s.taskType] = (taskTypes[s.taskType] ?? 0) + secs;
        for (const lang of (s.languages ?? [])) {
          languages[lang] = (languages[lang] ?? 0) + secs;
        }
      }
      userTimeSeconds = totalSeconds;
      aiTimeSeconds = totalSeconds;
      multiplier = 1;
      streakDays = 0;
    }

    const payload: SyncPayload = {
      date,
      totalSeconds,
      userTimeSeconds,
      aiTimeSeconds,
      multiplier,
      promptCount: daySessions.length,
      streakDays,
      clients,
      taskTypes,
      languages,
      sessions: daySessions,
      clientVersion: CLIENT_VERSION,
      syncSignature: "",
    };

    const res = await apiFetch<{ synced?: boolean; sessions_inserted?: number }>("/api/sync", {
      method: "POST",
      token,
      body: payload,
    });

    if (res.ok) {
      result.synced += daySessions.length;
    } else {
      console.error(`[sync] Failed for ${date}: ${res.error} (status ${res.status})`);
      result.errors += daySessions.length;
    }
  }

  // Milestones are synced via _milestones embedded in each session — the cloud
  // /api/sync endpoint extracts and upserts them. No separate publish needed.

  return result;
}

// ---------------------------------------------------------------------------
// V1 sync — sends pre-assembled snake_case sessions directly to server
// ---------------------------------------------------------------------------

interface V1Session {
  session_id: string;
  client: string;
  task_type: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  languages?: string[];
  [key: string]: unknown;
}

/**
 * Sync v1 (legacy) sessions that are already in snake_case format.
 * Groups by date and sends in the old server format (no clientVersion).
 */
export async function syncV1Sessions(
  token: string,
  sessions: V1Session[],
): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, skipped: 0, errors: 0 };
  if (sessions.length === 0) return result;

  // Group by date
  const byDate = new Map<string, V1Session[]>();
  for (const s of sessions) {
    const date = (s.started_at ?? "").slice(0, 10);
    if (!date) { result.skipped++; continue; }
    const arr = byDate.get(date);
    if (arr) arr.push(s);
    else byDate.set(date, [s]);
  }

  for (const [date, daySessions] of byDate) {
    let totalSeconds = 0;
    const clients: Record<string, number> = {};
    const taskTypes: Record<string, number> = {};
    const languages: Record<string, number> = {};

    for (const s of daySessions) {
      const secs = s.duration_seconds ?? 0;
      totalSeconds += secs;
      if (s.client) clients[s.client] = (clients[s.client] ?? 0) + secs;
      if (s.task_type) taskTypes[s.task_type] = (taskTypes[s.task_type] ?? 0) + secs;
      for (const lang of (s.languages ?? [])) {
        languages[lang] = (languages[lang] ?? 0) + secs;
      }
    }

    // Strip prompt before sending (local only)
    const cleaned = daySessions.map(({ prompt: _p, ...rest }) => rest);

    const payload = {
      date,
      totalSeconds,
      clients,
      taskTypes,
      languages,
      sessions: cleaned,
      syncSignature: "",
    };

    const res = await apiFetch<{ synced?: boolean }>("/api/sync", {
      method: "POST",
      token,
      body: payload,
    });

    if (res.ok) {
      result.synced += daySessions.length;
    } else {
      result.errors += daySessions.length;
    }
  }

  return result;
}
