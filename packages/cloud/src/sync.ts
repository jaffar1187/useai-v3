import type { Session, UseaiConfig } from "@devness/useai-types";
const DAEMON_URL = "http://127.0.0.1:19200";
import { apiFetch } from "./api-client.js";
import type { SanitizedSession, SyncPayload, SyncResult } from "./types.js";

const CLIENT_VERSION = "3.0.0";

// ---------------------------------------------------------------------------
// Sanitization — builds session for sync based on settings toggles.
// Each section matches a toggle in the dashboard settings UI.
// Fields listed here match the (i) info tooltips exactly.
// ---------------------------------------------------------------------------

function sanitizeSession(
  session: Session,
  sync: UseaiConfig["sync"],
): SanitizedSession {
  // ── Always sent (core session data) ───────────────────────────────────
  const result: Record<string, unknown> = {
    promptId: session.promptId,
    connectionId: session.connectionId,
    client: session.client,
    taskType: session.taskType,
    title: session.title,
    model: session.model,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    durationMs: session.durationMs,
    languages: session.languages,
    filesTouchedCount: session.filesTouchedCount,
    activeSegments: session.activeSegments,
    promptImageCount: session.promptImageCount,
    prevHash: session.prevHash,
    hash: session.hash,
    signature: session.signature,
  };

  // ── Evaluation scores (toggle: evaluationScores) ──────────────────────
  // Fields: promptQuality, contextProvided, scopeQuality,
  //         independenceLevel, taskOutcome, iterationCount, toolsLeveraged
  if (sync.includeEvaluation && session.evaluation) {
    const ev = session.evaluation;
    const evalObj: Record<string, unknown> = {
      prompt_quality: ev.prompt_quality,
      context_provided: ev.context_provided,
      scope_quality: ev.scope_quality,
      independence_level: ev.independence_level,
      task_outcome: ev.task_outcome,
      iteration_count: ev.iteration_count,
      tools_leveraged: ev.tools_leveraged,
    };

    // ── Evaluation reasons (dropdown: evaluationReasons) ────────────────
    // Fields: promptQualityReason, contextProvidedReason,
    //         scopeQualityReason, independenceLevelReason,
    //         taskOutcomeReason, *Ideal (calibrated only)
    if (sync.includeEvaluationReasons === "all") {
      evalObj["prompt_quality_reason"] = ev.prompt_quality_reason;
      evalObj["context_provided_reason"] = ev.context_provided_reason;
      evalObj["scope_quality_reason"] = ev.scope_quality_reason;
      evalObj["independence_level_reason"] = ev.independence_level_reason;
      evalObj["task_outcome_reason"] = ev.task_outcome_reason;
      evalObj["prompt_quality_ideal"] = ev.prompt_quality_ideal;
      evalObj["context_provided_ideal"] = ev.context_provided_ideal;
      evalObj["scope_quality_ideal"] = ev.scope_quality_ideal;
      evalObj["independence_level_ideal"] = ev.independence_level_ideal;
      evalObj["task_outcome_ideal"] = ev.task_outcome_ideal;
    } else if (sync.includeEvaluationReasons === "below_perfect") {
      if (ev.prompt_quality < 5) { evalObj["prompt_quality_reason"] = ev.prompt_quality_reason; evalObj["prompt_quality_ideal"] = ev.prompt_quality_ideal; }
      if (ev.context_provided < 5) { evalObj["context_provided_reason"] = ev.context_provided_reason; evalObj["context_provided_ideal"] = ev.context_provided_ideal; }
      if (ev.scope_quality < 5) { evalObj["scope_quality_reason"] = ev.scope_quality_reason; evalObj["scope_quality_ideal"] = ev.scope_quality_ideal; }
      if (ev.independence_level < 5) { evalObj["independence_level_reason"] = ev.independence_level_reason; evalObj["independence_level_ideal"] = ev.independence_level_ideal; }
      evalObj["task_outcome_reason"] = ev.task_outcome_reason;
      evalObj["task_outcome_ideal"] = ev.task_outcome_ideal;
    }
    // "none" — scores only, no reasons

    result["evaluation"] = evalObj;
  }

  // ── Milestones (toggle: milestones) ───────────────────────────────────
  // Fields: title, privateTitle, category, complexity
  if (sync.includeMilestones && session.milestones) {
    result["milestones"] = session.milestones;
  }

  // ── Private details (toggle: includePrivateDetails) ───────────────────
  // Fields: privateTitle, project
  if (sync.includePrivateDetails) {
    result["privateTitle"] = session.privateTitle;
    result["project"] = session.project;
  }

  return result as unknown as SanitizedSession;
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

    let userTimeSeconds: number;
    let aiTimeSeconds: number;
    let multiplier: number;
    let streakDays: number;
    let clients: Record<string, number>;
    let taskTypes: Record<string, number>;
    let languages: Record<string, number>;

    if (agg) {
      // Use daemon-computed stats
      userTimeSeconds = Math.round(agg.stats.coveredHours * 3600);
      aiTimeSeconds = Math.round(agg.stats.totalHours * 3600);
      multiplier = agg.stats.aiMultiplier;
      streakDays = agg.stats.currentStreak;
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
      aiTimeSeconds = 0;
      clients = {};
      taskTypes = {};
      languages = {};
      for (const s of daySessions) {
        const secs = Math.round(s.durationMs / 1000);
        aiTimeSeconds += secs;
        clients[s.client] = (clients[s.client] ?? 0) + secs;
        taskTypes[s.taskType] = (taskTypes[s.taskType] ?? 0) + secs;
        for (const lang of (s.languages ?? [])) {
          languages[lang] = (languages[lang] ?? 0) + secs;
        }
      }
      userTimeSeconds = aiTimeSeconds;
      multiplier = 1;
      streakDays = 0;
    }

    const payload: SyncPayload = {
      date,
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
    let aiTimeSeconds = 0;
    const clients: Record<string, number> = {};
    const taskTypes: Record<string, number> = {};
    const languages: Record<string, number> = {};

    for (const s of daySessions) {
      const secs = s.duration_seconds ?? 0;
      aiTimeSeconds += secs;
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
      aiTimeSeconds,
      userTimeSeconds: aiTimeSeconds,
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
