import type { SessionSeal, Milestone } from './api';

/** Convert an ISO timestamp (or Date) to a local YYYY-MM-DD string */
function toLocalDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Module-level timestamp cache — avoids repeated new Date(iso).getTime()
// across filterSessionsByWindow, countSessionsOutsideWindow, etc.
const _tsCache = new Map<string, number>();
export function parseTimestamp(iso: string): number {
  let v = _tsCache.get(iso);
  if (v === undefined) {
    v = new Date(iso).getTime();
    _tsCache.set(iso, v);
  }
  return v;
}

export interface ComputedStats {
  totalHours: number;
  totalSessions: number;
  /** Wall-clock span from earliest session start to latest session end (hours) */
  actualSpanHours: number;
  /** Union of all active session intervals (idle-excluded) — real user time where at least 1 session was active (hours) */
  coveredHours: number;
  /** Ratio of total AI time to user time (totalHours / coveredHours). >= 1.0 always. */
  aiMultiplier: number;
  /** Maximum number of sessions running concurrently at any point */
  peakConcurrency: number;
  currentStreak: number;
  filesTouched: number;
  featuresShipped: number;
  bugsFixed: number;
  complexSolved: number;
  totalMilestones: number;
  completionRate: number;
  activeProjects: number;
  byClient: Record<string, number>;
  byLanguage: Record<string, number>;
  byTaskType: Record<string, number>;
  byProject: Record<string, number>;
  /** Clock-time project breakdown via shared sweep-line */
  byProjectClock: Record<string, number>;
  /** AI-time (sum of duration_seconds) breakdowns — no concurrency dedup */
  byClientAI: Record<string, number>;
  byLanguageAI: Record<string, number>;
  byTaskTypeAI: Record<string, number>;
}

export function computeMilestoneStats(milestones: Milestone[]): {
  featuresShipped: number;
  bugsFixed: number;
  complexSolved: number;
} {
  let featuresShipped = 0;
  let bugsFixed = 0;
  let complexSolved = 0;

  for (const m of milestones) {
    if (m.category === 'feature') featuresShipped++;
    if (m.category === 'bugfix') bugsFixed++;
    if (m.complexity === 'complex') complexSolved++;
  }

  return { featuresShipped, bugsFixed, complexSolved };
}

/**
 * Sweep-line clock-time breakdown: distributes wall-clock time proportionally
 * among distinct active keys. When N keys are active concurrently, each gets
 * 1/N of the wall-clock slice.
 *
 * Uses active_segments when available; falls back to
 * [started_at, started_at + duration_seconds] for older sessions.
 */
function computeClockTimeBreakdown(
  sessions: SessionSeal[],
  getKeys: (s: SessionSeal) => string[],
): Record<string, number> {
  type Event = { time: number; key: string; delta: 1 | -1 };
  const events: Event[] = [];

  for (const s of sessions) {
    const keys = getKeys(s);
    if (keys.length === 0) continue;

    const sStart = parseTimestamp(s.startedAt);
    const sEnd = parseTimestamp(s.endedAt);
    if (sEnd <= sStart) continue;

    // Gather active time intervals
    const segments: [number, number][] = [];
    if (s.activeSegments && s.activeSegments.length > 0) {
      for (const [segStart, segEnd] of s.activeSegments) {
        const t0 = parseTimestamp(segStart);
        const t1 = parseTimestamp(segEnd);
        if (t1 > t0) segments.push([t0, t1]);
      }
    } else {
      // Backward compat: approximate with [start, start + duration]
      const activeDurationMs = s.durationMs;
      const activeEnd = Math.min(sStart + activeDurationMs, sEnd);
      if (activeEnd > sStart) segments.push([sStart, activeEnd]);
    }

    for (const [t0, t1] of segments) {
      for (const key of keys) {
        events.push({ time: t0, key, delta: 1 });
        events.push({ time: t1, key, delta: -1 });
      }
    }
  }

  events.sort((a, b) => a.time - b.time || a.delta - b.delta);

  const map: Record<string, number> = {};
  const activeCount: Record<string, number> = {};
  let prevTime = 0;

  for (const e of events) {
    const activeKeys = Object.keys(activeCount).filter((k) => activeCount[k]! > 0);
    if (activeKeys.length > 0 && e.time > prevTime) {
      const sliceMs = e.time - prevTime;
      const share = sliceMs / activeKeys.length;
      for (const k of activeKeys) {
        map[k] = (map[k] ?? 0) + share;
      }
    }

    prevTime = e.time;
    activeCount[e.key] = (activeCount[e.key] ?? 0) + e.delta;
    if (activeCount[e.key] === 0) delete activeCount[e.key];
  }

  const result: Record<string, number> = {};
  for (const [key, ms] of Object.entries(map)) {
    if (ms > 0) result[key] = ms / 1000;
  }
  return result;
}


export function computeStats(sessions: SessionSeal[], milestones: Milestone[] = []): ComputedStats {
  let totalSeconds = 0;
  let filesTouched = 0;
  const byProject: Record<string, number> = {};
  const byClientAI: Record<string, number> = {};
  const byLanguageAI: Record<string, number> = {};
  const byTaskTypeAI: Record<string, number> = {};

  for (const s of sessions) {
    totalSeconds += Math.round(s.durationMs / 1000);
    filesTouched += s.filesTouched;

    const project = s.project || 'other';
    byProject[project] = (byProject[project] ?? 0) + Math.round(s.durationMs / 1000);

    byClientAI[s.client] = (byClientAI[s.client] ?? 0) + Math.round(s.durationMs / 1000);
    byTaskTypeAI[s.taskType] = (byTaskTypeAI[s.taskType] ?? 0) + Math.round(s.durationMs / 1000);

    const langs = s.languages.map((l) => l.toLowerCase());
    if (langs.length > 0) {
      const share = Math.round(s.durationMs / 1000) / langs.length;
      for (const lang of langs) {
        byLanguageAI[lang] = (byLanguageAI[lang] ?? 0) + share;
      }
    } else {
      byLanguageAI['other'] = (byLanguageAI["other"] ?? 0) + Math.round(s.durationMs / 1000);
    }
  }

  // Clock-time breakdowns via sweep-line (uses active_segments, falls back to duration_seconds)
  const byClient = computeClockTimeBreakdown(sessions, (s) => [s.client]);
  const byLanguage = computeClockTimeBreakdown(sessions, (s) => {
    const langs = s.languages.map((l) => l.toLowerCase());
    return langs.length > 0 ? langs : ['other'];
  });
  const byTaskType = computeClockTimeBreakdown(sessions, (s) => [s.taskType]);
  const byProjectClock = computeClockTimeBreakdown(sessions, (s) => [s.project || 'other']);

  // Actual time span, covered time, and peak concurrency (sweep-line)
  let actualSpanHours = 0;
  let coveredHours = 0;
  let aiMultiplier = 0;
  let peakConcurrency = 0;

  if (sessions.length > 0) {
    let minStart = Infinity;
    let maxEnd = -Infinity;
    const events: { time: number; delta: number }[] = [];

    for (const s of sessions) {
      const sStart = parseTimestamp(s.startedAt);
      const sEnd = parseTimestamp(s.endedAt);
      if (sStart < minStart) minStart = sStart;
      if (sEnd > maxEnd) maxEnd = sEnd;

      if (s.activeSegments && s.activeSegments.length > 0) {
        // Use actual active segments for accurate union
        for (const [segStart, segEnd] of s.activeSegments) {
          events.push({ time: parseTimestamp(segStart), delta: 1 });
          events.push({ time: parseTimestamp(segEnd), delta: -1 });
        }
      } else {
        // Fallback: approximate with [startedAt, startedAt + duration]
        const activeDurationMs = s.durationMs;
        const activeEnd = Math.min(sStart + activeDurationMs, sEnd);
        events.push({ time: sStart, delta: 1 });
        events.push({ time: activeEnd, delta: -1 });
      }
    }

    actualSpanHours = (maxEnd - minStart) / 3600000;

    // Sort events: by time, then ends (-1) before starts (+1) at same timestamp
    events.sort((a, b) => a.time - b.time || a.delta - b.delta);
    let running = 0;
    let coveredMs = 0; // total time where at least 1 session was active
    let lastActiveStart = 0;
    for (const e of events) {
      const wasActive = running > 0;
      running += e.delta;
      if (running > peakConcurrency) peakConcurrency = running;

      if (!wasActive && running > 0) {
        // Transition from idle → active
        lastActiveStart = e.time;
      } else if (wasActive && running === 0) {
        // Transition from active → idle
        coveredMs += e.time - lastActiveStart;
      }
    }

    coveredHours = coveredMs / 3600000;
    // Multiplier = total AI time / time where AI was active (not the full span)
    // 1.0x = no parallelism, 2.0x = avg 2 sessions running when active
    aiMultiplier = coveredHours > 0 ? (totalSeconds / 3600) / coveredHours : 0;
  }

  const milestoneStats = computeMilestoneStats(milestones);

  // Completion rate from sessions with evaluations
  const evaluated = sessions.filter((s) => s.evaluation && typeof s.evaluation === 'object');
  const completed = evaluated.filter((s) => s.evaluation!.task_outcome === 'completed').length;
  const completionRate = evaluated.length > 0 ? Math.round((completed / evaluated.length) * 100) : 0;

  // Active projects
  const activeProjects = Object.keys(byProject).length;

  return {
    totalHours: totalSeconds / 3600,
    totalSessions: sessions.length,
    actualSpanHours,
    coveredHours,
    aiMultiplier,
    peakConcurrency,
    currentStreak: calculateStreak(sessions),
    filesTouched: Math.round(filesTouched),
    ...milestoneStats,
    totalMilestones: milestones.length,
    completionRate,
    activeProjects,
    byClient,
    byLanguage,
    byTaskType,
    byProject,
    byProjectClock,
    byClientAI,
    byLanguageAI,
    byTaskTypeAI,
  };
}

export function calculateStreak(sessions: SessionSeal[]): number {
  if (sessions.length === 0) return 0;

  const days = new Set<string>();
  for (const s of sessions) {
    if (s.startedAt && s.endedAt && s.durationMs > 0) days.add(toLocalDate(s.startedAt));
  }

  const sorted = [...days].sort().reverse();
  if (sorted.length === 0) return 0;

  const today = toLocalDate(new Date());
  const yesterday = toLocalDate(new Date(Date.now() - 86400000));

  if (sorted[0] !== today && sorted[0] !== yesterday) return 0;

  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]!);
    const curr = new Date(sorted[i]!);
    const diffDays = (prev.getTime() - curr.getTime()) / 86400000;
    if (diffDays === 1) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

/** Count sessions that fall entirely outside a time window */
export function countSessionsOutsideWindow(
  allSessions: SessionSeal[],
  windowStart: number,
  windowEnd: number,
): { before: number; after: number } {
  let before = 0;
  let after = 0;
  for (const s of allSessions) {
    if (!s.endedAt || s.durationMs <= 0) continue;
    const sEnd = parseTimestamp(s.endedAt);
    const sStart = parseTimestamp(s.startedAt);
    if (sEnd < windowStart) before++;
    else if (sStart > windowEnd) after++;
  }
  return { before, after };
}

/** Filter sessions that overlap with a time window */
export function filterSessionsByWindow(
  sessions: SessionSeal[],
  start: number,
  end: number,
): SessionSeal[] {
  return sessions.filter((s) => {
    const sStart = parseTimestamp(s.startedAt);
    const sEnd = parseTimestamp(s.endedAt);
    return sStart <= end && sEnd >= start;
  });
}

/** Filter milestones by time window */
export function filterMilestonesByWindow(
  milestones: Milestone[],
  start: number,
  end: number,
): Milestone[] {
  return milestones.filter((m) => {
    const t = parseTimestamp(m.createdAt);
    return t >= start && t <= end;
  });
}

export interface PromptGroup {
  prompt: SessionSeal;
  milestones: Milestone[];
}

/** A conversation is a group of prompts sharing the same connectionId */
export interface ConversationGroup {
  conversationId: string | null;
  prompts: PromptGroup[];
  /** Aggregate evaluation across all sessions in the conversation */
  aggregateEval: AggregateEvaluation | null;
  totalDuration: number;
  totalMilestones: number;
  startedAt: string;
  endedAt: string;
  /** Start time of the most recent session (for display, matches child row times) */
  lastSessionAt: string;
}

export interface AggregateEvaluation {
  prompt_quality: number;
  context_provided: number;
  independence_level: number;
  scope_quality: number;
  tools_leveraged: number;
  total_iterations: number;
  outcomes: Record<string, number>;
  session_count: number;
}

/** Group ALL sessions with their milestones attached (empty array if none) */
export function groupPromptsWithMilestones(
  prompts: SessionSeal[],
  milestones: Milestone[],
): PromptGroup[] {
  const milestoneMap = new Map<string, Milestone[]>();
  for (const m of milestones) {
    const existing = milestoneMap.get(m.promptId);
    if (existing) {
      existing.push(m);
    } else {
      milestoneMap.set(m.promptId, [m]);
    }
  }

  const result: PromptGroup[] = prompts.map((prompt) => ({
    prompt: prompt,
    milestones: milestoneMap.get(prompt.promptId) ?? [],
  }));

  // Sort by session end time, most recent first
  result.sort((a, b) => parseTimestamp(b.prompt.endedAt) - parseTimestamp(a.prompt.endedAt));

  return result;
}

/** Compute aggregate evaluation from multiple sessions */
function computeAggregateEval(prompts: PromptGroup[]): AggregateEvaluation | null {
  const withEval = prompts.filter((p) => p.prompt.evaluation);
  if (withEval.length === 0) return null;

  let promptSum = 0, contextSum = 0, indepSum = 0, scopeSum = 0, toolsSum = 0, iterSum = 0;
  const outcomes: Record<string, number> = {};

  for (const p of withEval) {
    const e = p.prompt.evaluation!;
    promptSum += e.prompt_quality;
    contextSum += e.context_provided;
    indepSum += e.independence_level;
    scopeSum += e.scope_quality;
    toolsSum += e.tools_leveraged;
    iterSum += e.iteration_count;
    outcomes[e.task_outcome] = (outcomes[e.task_outcome] ?? 0) + 1;
  }

  const n = withEval.length;
  return {
    prompt_quality: Math.round((promptSum / n) * 10) / 10,
    context_provided: Math.round((contextSum / n) * 10) / 10,
    independence_level: Math.round((indepSum / n) * 10) / 10,
    scope_quality: Math.round((scopeSum / n) * 10) / 10,
    tools_leveraged: Math.round(toolsSum / n),
    total_iterations: iterSum,
    outcomes,
    session_count: n,
  };
}

/** Group sessions into conversations. Sessions without conversation_id are standalone. */
export function groupIntoConversations(
  sessionGroups: PromptGroup[],
): ConversationGroup[] {
  const convMap = new Map<string, PromptGroup[]>();
  const standalone: PromptGroup[] = [];

  for (const pg of sessionGroups) {
    const convId = pg.prompt.conversationId;
    if (convId) {
      const existing = convMap.get(convId);
      if (existing) {
        existing.push(pg);
      } else {
        convMap.set(convId, [pg]);
      }
    } else {
      standalone.push(pg);
    }
  }

  const result: ConversationGroup[] = [];

  for (const [connectionId, prompts] of convMap) {
    // Sort prompts within conversation: latest first (descending by end time)
    prompts.sort((a, b) => parseTimestamp(b.prompt.endedAt) - parseTimestamp(a.prompt.endedAt));

    const totalDuration = prompts.reduce((sum, p) => sum + Math.round(p.prompt.durationMs / 1000), 0);
    const totalMilestones = prompts.reduce((sum, p) => sum + p.milestones.length, 0);
    // First element is now the latest prompt (descending order)
    const startedAt = prompts[prompts.length - 1]!.prompt.startedAt;
    const endedAt = prompts[0]!.prompt.endedAt;
    const lastSessionAt = prompts[0]!.prompt.endedAt;

    result.push({
      conversationId: connectionId,
      prompts,
      aggregateEval: computeAggregateEval(prompts),
      totalDuration,
      totalMilestones,
      startedAt,
      endedAt,
      lastSessionAt,
    });
  }

  for (const pg of standalone) {
    result.push({
      conversationId: null,
      prompts: [pg],
      aggregateEval: pg.prompt.evaluation ? computeAggregateEval([pg]) : null,
      totalDuration: Math.round(pg.prompt.durationMs / 1000),
      totalMilestones: pg.milestones.length,
      startedAt: pg.prompt.startedAt,
      endedAt: pg.prompt.endedAt,
      lastSessionAt: pg.prompt.endedAt,
    });
  }

  result.sort((a, b) => parseTimestamp(b.lastSessionAt) - parseTimestamp(a.lastSessionAt));

  return result;
}

/** Get a human-readable label for the current time window */
export function getTimeContextLabel(windowStart: number, windowEnd: number, isLive: boolean): string {
  if (isLive) return 'Live';

  const midpoint = (windowStart + windowEnd) / 2;
  const midDate = new Date(midpoint);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);

  if (midDate.toDateString() === today.toDateString()) return 'Today';
  if (midDate.toDateString() === yesterday.toDateString()) return 'Yesterday';

  return midDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Merge overlapping/adjacent time intervals into non-overlapping spans */
function mergeIntervals(intervals: [number, number][]): [number, number][] {
  if (intervals.length === 0) return [];
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
  return merged;
}

/** Collect active intervals for a session, clamped to a time window.
 *  Uses active_segments when available; falls back to duration-capped range. */
function collectSessionIntervals(
  s: SessionSeal,
  windowStart: number,
  windowEnd: number,
): [number, number][] {
  const sStart = parseTimestamp(s.startedAt);
  const sEnd = parseTimestamp(s.endedAt);
  const intervals: [number, number][] = [];

  if (s.activeSegments && s.activeSegments.length > 0) {
    for (const [segStart, segEnd] of s.activeSegments) {
      const t0 = parseTimestamp(segStart);
      const t1 = parseTimestamp(segEnd);
      if (t1 <= t0 || t1 < windowStart || t0 > windowEnd) continue;
      intervals.push([Math.max(t0, windowStart), Math.min(t1, windowEnd)]);
    }
  } else {
    // Backward compat: cap to [start, start + duration] to avoid inflation
    const durationMs = (s.durationMs ?? 0) * 1000;
    const wallClockMs = sEnd - sStart;
    const gapThresholdMs = 10 * 60 * 1000;

    if (durationMs === 0 && wallClockMs > gapThresholdMs) return [];

    const effectiveEnd = durationMs > 0 && wallClockMs > durationMs + gapThresholdMs
      ? sStart + durationMs
      : sEnd;

    if (effectiveEnd <= sStart || effectiveEnd < windowStart || sStart > windowEnd) return [];
    intervals.push([Math.max(sStart, windowStart), Math.min(effectiveEnd, windowEnd)]);
  }

  return intervals;
}

/** Get hourly activity for a given day — returns 24 entries with minutes per hour */
export function getHourlyActivity(sessions: SessionSeal[], date: string): { hour: number; minutes: number }[] {
  const dayStart = new Date(`${date}T00:00:00`).getTime();
  const dayEnd = dayStart + 86400000;

  const result: { hour: number; minutes: number }[] = [];
  for (let h = 0; h < 24; h++) {
    result.push({ hour: h, minutes: 0 });
  }

  const intervals: [number, number][] = [];
  for (const s of sessions) {
    intervals.push(...collectSessionIntervals(s, dayStart, dayEnd));
  }

  for (const [clampedStart, clampedEnd] of mergeIntervals(intervals)) {
    for (let h = 0; h < 24; h++) {
      const hourStart = dayStart + h * 3600000;
      const hourEnd = hourStart + 3600000;
      const overlapStart = Math.max(clampedStart, hourStart);
      const overlapEnd = Math.min(clampedEnd, hourEnd);
      if (overlapEnd > overlapStart) {
        result[h]!.minutes += (overlapEnd - overlapStart) / 60000;
      }
    }
  }

  return result;
}

/** Get daily hours for last N days — uses active_segments with backward compat */
export function getDailyActivity(sessions: SessionSeal[], days: number): { date: string; hours: number }[] {
  const now = new Date();
  const result: { date: string; hours: number }[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = toLocalDate(d);
    const dayStart = new Date(`${dateStr}T00:00:00`).getTime();
    const dayEnd = dayStart + 86400000;

    const intervals: [number, number][] = [];
    for (const s of sessions) {
      intervals.push(...collectSessionIntervals(s, dayStart, dayEnd));
    }

    let totalMs = 0;
    for (const [start, end] of mergeIntervals(intervals)) {
      totalMs += end - start;
    }

    result.push({ date: dateStr, hours: totalMs / 3600000 });
  }

  return result;
}

/** AI-time hourly activity — sums duration_seconds per hour (no dedup) */
export function getHourlyActivityAI(sessions: SessionSeal[], date: string): { hour: number; minutes: number }[] {
  const dayStart = new Date(`${date}T00:00:00`).getTime();
  const dayEnd = dayStart + 86400000;

  const result: { hour: number; minutes: number }[] = [];
  for (let h = 0; h < 24; h++) {
    result.push({ hour: h, minutes: 0 });
  }

  for (const s of sessions) {
    const sStart = parseTimestamp(s.startedAt);
    if (sStart < dayStart || sStart >= dayEnd) continue;
    const hour = new Date(sStart).getHours();
    result[hour]!.minutes += s.durationMs / 60000;
  }

  return result;
}

/** AI-time daily activity — sums duration_seconds per day (no dedup) */
export function getDailyActivityAI(sessions: SessionSeal[], days: number): { date: string; hours: number }[] {
  const now = new Date();
  const result: { date: string; hours: number }[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = toLocalDate(d);

    let seconds = 0;
    for (const s of sessions) {
      if (toLocalDate(s.startedAt) === dateStr) {
        seconds += Math.round(s.durationMs / 1000);
      }
    }

    result.push({ date: dateStr, hours: seconds / 3600 });
  }

  return result;
}
