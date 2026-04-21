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
  // ── Always sent ───────────────────────────────────
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

  // ── Evaluation (scores always sent, reasons controlled by evaluationReasons) ─
  if (session.evaluation) {
    const ev = session.evaluation;
    const evalObj: Record<string, unknown> = {
      promptQuality: ev.prompt_quality,
      contextProvided: ev.context_provided,
      scopeQuality: ev.scope_quality,
      independenceLevel: ev.independence_level,
      taskOutcome: ev.task_outcome,
      iterationCount: ev.iteration_count,
      toolsLeveraged: ev.tools_leveraged,
    };

    if (sync.evaluationReasons === "all") {
      evalObj["promptQualityReason"] = ev.prompt_quality_reason;
      evalObj["contextProvidedReason"] = ev.context_provided_reason;
      evalObj["scopeQualityReason"] = ev.scope_quality_reason;
      evalObj["independenceLevelReason"] = ev.independence_level_reason;
      evalObj["taskOutcomeReason"] = ev.task_outcome_reason;
      evalObj["promptQualityIdeal"] = ev.prompt_quality_ideal;
      evalObj["contextProvidedIdeal"] = ev.context_provided_ideal;
      evalObj["scopeQualityIdeal"] = ev.scope_quality_ideal;
      evalObj["independenceLevelIdeal"] = ev.independence_level_ideal;
      evalObj["taskOutcomeIdeal"] = ev.task_outcome_ideal;
    } else if (sync.evaluationReasons === "belowPerfect") {
      if (ev.prompt_quality < 5) {
        evalObj["promptQualityReason"] = ev.prompt_quality_reason;
        evalObj["promptQualityIdeal"] = ev.prompt_quality_ideal;
      }
      if (ev.context_provided < 5) {
        evalObj["contextProvidedReason"] = ev.context_provided_reason;
        evalObj["contextProvidedIdeal"] = ev.context_provided_ideal;
      }
      if (ev.scope_quality < 5) {
        evalObj["scopeQualityReason"] = ev.scope_quality_reason;
        evalObj["scopeQualityIdeal"] = ev.scope_quality_ideal;
      }
      if (ev.independence_level < 5) {
        evalObj["independenceLevelReason"] = ev.independence_level_reason;
        evalObj["independenceLevelIdeal"] = ev.independence_level_ideal;
      }
      evalObj["taskOutcomeReason"] = ev.task_outcome_reason;
      evalObj["taskOutcomeIdeal"] = ev.task_outcome_ideal;
    }
    // "none" — scores only, no reasons

    result["evaluation"] = evalObj;
  }

  // ── Milestones (always synced, only visible to owner) ──────────────────
  if (session.milestones) {
    result["milestones"] = session.milestones;
  }

  // ── Private details (always synced, only visible to owner on web) ────
  // Fields: privateTitle, project
  result["privateTitle"] = session.privateTitle;
  result["project"] = session.project;

  return result as unknown as SanitizedSession;
}

// ---------------------------------------------------------------------------
// Group by date
// ---------------------------------------------------------------------------

function groupByDate(
  sessions: SanitizedSession[],
): Map<string, SanitizedSession[]> {
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
async function fetchDaemonAggregations(
  date: string,
): Promise<DaemonAggregationsResponse | null> {
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
    const params = new URLSearchParams({
      start,
      end,
      offset: String(offset),
      limit: String(limit),
    });
    const res = await fetch(`${DAEMON_URL}/api/local/prompts?${params}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) break;
    const json = (await res.json()) as {
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

  // Build all payloads first, then send in one batch request
  const payloads: SyncPayload[] = [];

  for (const [date, daySessions] of byDate) {
    const agg = await fetchDaemonAggregations(date);
    if (!agg) continue;

    const clockTimeSeconds = Math.round(agg.stats.coveredHours * 3600);
    const aiTimeSeconds = Math.round(agg.stats.totalHours * 3600);
    const multiplier = agg.stats.aiMultiplier;
    const streakDays = agg.stats.currentStreak;
    const clients = agg.stats.byAiToolDuration;
    const taskTypes = agg.stats.byTaskTypeAiTime;
    const languages = agg.stats.byLanguageAiTime;

    payloads.push({
      date,
      clockTimeSeconds,
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
    });
  }

  // Send all payloads in a single batch request
  const totalSessions = payloads.reduce((n, p) => n + p.sessions.length, 0);

  const batchRes = await apiFetch<{
    synced?: boolean;
    results?: Array<{ synced?: boolean; sessions_inserted?: number }>;
  }>("/api/sync", {
    method: "POST",
    token,
    body: payloads,
  });

  if (batchRes.ok) {
    result.synced += totalSessions;
  } else {
    console.error(
      `[sync] Batch failed: ${batchRes.error} (status ${batchRes.status})`,
    );
    result.errors += totalSessions;
  }

  return result;
}

