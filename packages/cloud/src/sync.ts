import type { Session, SessionEvaluation, UseaiConfig } from "@devness/useai-types";
import { apiFetch } from "./api-client.js";
import type { SanitizedSession, SyncPayload, SyncResult } from "./types.js";

const CLIENT_VERSION = "3.0.0";
const MILESTONE_CHUNK_SIZE = 50;

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
): SanitizedSession {
  // Always strip prompt (stays local)
  const { prompt: _prompt, ...withoutPrompt } = session;

  // Optionally strip evaluation
  if (!capture.evaluation || !withoutPrompt.evaluation) {
    const { evaluation: _eval, ...withoutEval } = withoutPrompt;
    return withoutEval;
  }

  return {
    ...withoutPrompt,
    evaluation: sanitizeEvaluation(
      withoutPrompt.evaluation,
      capture.reasonsLevel,
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
// Chunking
// ---------------------------------------------------------------------------

function chunkByMilestones(sessions: SanitizedSession[]): SanitizedSession[][] {
  const chunks: SanitizedSession[][] = [];
  let current: SanitizedSession[] = [];
  let milestoneCount = 0;

  for (const session of sessions) {
    const mCount = session.milestones.length;
    if (milestoneCount + mCount > MILESTONE_CHUNK_SIZE && current.length > 0) {
      chunks.push(current);
      current = [];
      milestoneCount = 0;
    }
    current.push(session);
    milestoneCount += mCount;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
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
  const sanitized = valid.map((s) => sanitizeSession(s, config.capture));

  // 4. Chunk by milestones and send
  const chunks = chunkByMilestones(sanitized);

  for (const chunk of chunks) {
    const payload: SyncPayload = {
      sessions: chunk,
      clientVersion: CLIENT_VERSION,
    };

    const res = await apiFetch<{ synced: number }>("/api/sync", {
      method: "POST",
      token,
      body: payload,
    });

    if (res.ok && res.data) {
      result.synced += res.data.synced;
    } else {
      result.errors += chunk.length;
    }
  }

  return result;
}
