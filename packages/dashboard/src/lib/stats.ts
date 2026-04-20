import type { SessionSeal, Milestone } from './api';

/** Convert an ISO timestamp (or Date) to a local YYYY-MM-DD string */
function toLocalDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Module-level timestamp cache — avoids repeated new Date(iso).getTime()
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
  byToolClockTime: Record<string, number>;
  byLanguageClockTime: Record<string, number>;
  byTaskTypeClockTime: Record<string, number>;
  byProjectAiTime: Record<string, number>;
  /** Clock-time project breakdown via shared sweep-line */
  byProjectClock: Record<string, number>;
  /** Cumulative session duration breakdowns — no concurrency dedup */
  byAiToolDuration: Record<string, number>;
  byLanguageAiTime: Record<string, number>;
  byTaskTypeAiTime: Record<string, number>;
}

export interface PromptGroup {
  prompt: SessionSeal;
  milestones: Milestone[];
}

/** A conversation is a group of prompts sharing the same connectionId */
export interface ConversationGroup {
  connectionId: string;
  prompts: PromptGroup[];
  /** Aggregate evaluation across all sessions in the conversation */
  aggregateEval: AggregateEvaluation | null;
  aiTime: number;
  totalMilestones: number;
  startedAt: string;
  endedAt: string;
  /** Start time of the most recent session (for display, matches child row times) */
  lastSessionAt: string;
}

export interface AggregateEvaluation {
  promptQuality: number;
  contextProvided: number;
  independenceLevel: number;
  scopeQuality: number;
  toolsLeveraged: number;
  promptCount: number;
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
