import type { Session, SessionEvaluation, UseaiConfig } from "@devness/useai-types";
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

  // Strip all *_reason fields for "none" or "below_perfect"
  const {
    prompt_quality_reason: _pqr,
    context_provided_reason: _cpr,
    task_outcome_reason: _tor,
    independence_level_reason: _ilr,
    scope_quality_reason: _sqr,
    ...rest
  } = evaluation;

  return rest;
}

function sanitizeSession(
  session: Session,
  sync: UseaiConfig["sync"],
): SanitizedSession {
  // Always strip prompt (stays local)
  const { prompt: _prompt, ...withoutPrompt } = session;

  // Strip private details if includePrivateDetails is false
  if (!sync.includePrivateDetails) {
    delete withoutPrompt.privateTitle;
    delete withoutPrompt.project;
  }

  // Optionally strip evaluation
  if (!sync.includeEvaluation || !withoutPrompt.evaluation) {
    const { evaluation: _eval, ...withoutEval } = withoutPrompt;
    return withoutEval;
  }

  return {
    ...withoutPrompt,
    evaluation: sanitizeEvaluation(
      withoutPrompt.evaluation,
      sync.includePrivateDetails ? sync.includeEvaluationReasons : "none",
    ),
  };
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function deduplicateSessions(sessions: Session[]): Session[] {
  const map = new Map<string, Session>();
  for (const session of sessions) {
    const existing = map.get(session.promptId);
    if (!existing || session.durationMs > existing.durationMs) {
      map.set(session.promptId, session);
    }
  }
  return Array.from(map.values());
}

// ---------------------------------------------------------------------------
// Chain validation
// ---------------------------------------------------------------------------

function hasValidChainLinks(sessions: Session[]): boolean {
  const sorted = [...sessions].sort((a, b) =>
    a.startedAt.localeCompare(b.startedAt),
  );
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (prev && curr && curr.prevHash !== "0".repeat(64) && curr.prevHash !== prev.hash) {
      return false;
    }
  }
  return true;
}

function filterValidSessions(sessions: Session[]): Session[] {
  // Remove sessions with no hash (unsigned)
  const signed = sessions.filter((s) => s.hash && s.signature);

  // Group by connectionId and validate chain linkage per connection
  const byConnection = new Map<string, Session[]>();
  for (const session of signed) {
    const group = byConnection.get(session.connectionId) ?? [];
    group.push(session);
    byConnection.set(session.connectionId, group);
  }

  const valid: Session[] = [];
  for (const group of byConnection.values()) {
    if (hasValidChainLinks(group)) {
      valid.push(...group);
    } else {
      // Include sessions that have valid individual hashes even if chain is broken
      valid.push(...group.filter((s) => s.hash.length === 64));
    }
  }
  return valid;
}

// ---------------------------------------------------------------------------
// User time — union of active intervals (concurrent sessions deduped)
// ---------------------------------------------------------------------------

function computeUserTimeSeconds(sessions: SanitizedSession[]): number {
  const intervals: [number, number][] = [];

  for (const s of sessions) {
    const sStart = new Date(s.startedAt).getTime();
    const sEnd = new Date(s.endedAt).getTime();
    if (sEnd <= sStart) continue;

    if (s.activeSegments && s.activeSegments.length > 0) {
      for (const [segStart, segEnd] of s.activeSegments) {
        const t0 = new Date(segStart).getTime();
        const t1 = new Date(segEnd).getTime();
        if (t1 > t0) intervals.push([t0, t1]);
      }
    } else {
      // Backward compat: approximate with [start, start + duration]
      const durationMs = s.durationMs;
      const activeEnd = Math.min(sStart + durationMs, sEnd);
      if (activeEnd > sStart) intervals.push([sStart, activeEnd]);
    }
  }

  if (intervals.length === 0) return 0;

  // Merge overlapping intervals
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [intervals[0]!];
  for (let i = 1; i < intervals.length; i++) {
    const [start, end] = intervals[i]!;
    const last = merged[merged.length - 1]!;
    if (start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }

  let totalMs = 0;
  for (const [start, end] of merged) {
    totalMs += end - start;
  }
  return Math.round(totalMs / 1000);
}

// ---------------------------------------------------------------------------
// Streak — consecutive days with at least one session
// ---------------------------------------------------------------------------

function computeStreakDays(allDates: string[]): number {
  if (allDates.length === 0) return 0;

  const days = [...new Set(allDates)].sort().reverse();
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  if (days[0] !== today && days[0] !== yesterday) return 0;

  let streak = 1;
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1]!).getTime();
    const curr = new Date(days[i]!).getTime();
    if (prev - curr === 86400000) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
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
// Main sync
// ---------------------------------------------------------------------------

export async function syncSessions(
  token: string,
  sessions: Session[],
  config: UseaiConfig,
): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, skipped: 0, errors: 0 };

  if (sessions.length === 0) return result;

  // 1. Deduplicate
  const deduped = deduplicateSessions(sessions);
  result.skipped += sessions.length - deduped.length;

  // 2. Validate chain
  const valid = filterValidSessions(deduped);
  result.skipped += deduped.length - valid.length;

  // 3. Sanitize
  const sanitized = valid.map((s) => sanitizeSession(s, config.sync));

  // 4. Group by date and send per-date payloads
  const byDate = groupByDate(sanitized);

  // Collect all dates for streak calculation
  const allDates = [...byDate.keys()];
  const streakDays = computeStreakDays(allDates);

  for (const [date, daySessions] of byDate) {
    let totalSeconds = 0;
    const clients: Record<string, number> = {};
    const taskTypes: Record<string, number> = {};
    const languages: Record<string, number> = {};

    for (const s of daySessions) {
      const secs = Math.round(s.durationMs / 1000);
      totalSeconds += secs;
      clients[s.client] = (clients[s.client] ?? 0) + secs;
      taskTypes[s.taskType] = (taskTypes[s.taskType] ?? 0) + secs;
      for (const lang of (s.languages ?? [])) {
        languages[lang] = (languages[lang] ?? 0) + secs;
      }
    }

    const userTimeSeconds = computeUserTimeSeconds(daySessions);
    const aiTimeSeconds = totalSeconds;
    const multiplier = userTimeSeconds > 0
      ? Math.round((aiTimeSeconds / userTimeSeconds) * 100) / 100
      : 0;

    const payload: SyncPayload = {
      date,
      total_seconds: totalSeconds,
      user_time_seconds: userTimeSeconds,
      ai_time_seconds: aiTimeSeconds,
      multiplier,
      prompt_count: daySessions.length,
      streak_days: streakDays,
      clients,
      task_types: taskTypes,
      languages,
      sessions: daySessions,
      clientVersion: CLIENT_VERSION,
      sync_signature: "",
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
      total_seconds: totalSeconds,
      clients,
      task_types: taskTypes,
      languages,
      sessions: cleaned,
      sync_signature: "",
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

