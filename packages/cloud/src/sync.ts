import type { Session, SessionEvaluation, UseaiConfig } from "@devness/useai-types";
import { apiFetch } from "./api-client.js";
import type { SanitizedSession, SyncPayload, SyncResult } from "./types.js";

const CLIENT_VERSION = "3.0.0";

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

function sanitizeEvaluation(
  evaluation: SessionEvaluation,
  reasonsLevel: UseaiConfig["capture"]["reasonsLevel"],
): SessionEvaluation {
  if (reasonsLevel === "detailed") return evaluation;

  // Strip all *_reason fields for "none" or "summary"
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
  capture: UseaiConfig["capture"],
  includeDetails: boolean,
): SanitizedSession {
  // Always strip prompt (stays local)
  const { prompt: _prompt, ...withoutPrompt } = session;

  // Strip private details if includeDetails is false
  if (!includeDetails) {
    delete withoutPrompt.privateTitle;
    delete withoutPrompt.project;
  }

  // Optionally strip evaluation
  if (!capture.evaluation || !withoutPrompt.evaluation) {
    const { evaluation: _eval, ...withoutEval } = withoutPrompt;
    return withoutEval;
  }

  return {
    ...withoutPrompt,
    evaluation: sanitizeEvaluation(
      withoutPrompt.evaluation,
      includeDetails ? capture.reasonsLevel : "none",
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
  const includeDetails = config.sync.includeDetails ?? true;
  const sanitized = valid.map((s) => sanitizeSession(s, config.capture, includeDetails));

  // 4. Group by date and send per-date payloads
  const byDate = groupByDate(sanitized);

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

    const payload: SyncPayload = {
      date,
      total_seconds: totalSeconds,
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
      result.errors += daySessions.length;
    }
  }

  // 5. Publish milestones
  const allMilestones = valid.flatMap((s) =>
    s.milestones.map((m) => ({
      id: m.id,
      session_id: s.promptId,
      title: includeDetails ? m.title : m.title,
      ...(includeDetails && m.privateTitle ? { private_title: m.privateTitle } : {}),
      category: m.category,
      complexity: m.complexity ?? "medium",
      duration_minutes: Math.round(s.durationMs / 60000),
      languages: s.languages ?? [],
      client: s.client,
      chain_hash: s.hash,
    })),
  );

  if (allMilestones.length > 0) {
    await apiFetch("/api/publish", {
      method: "POST",
      token,
      body: { milestones: allMilestones },
    }).catch(() => {
      // Milestone publish failure is non-fatal
    });
  }

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
