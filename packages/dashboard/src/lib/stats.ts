import type { Session } from "@devness/useai-types";

export interface DayBucket {
  date: string; // YYYY-MM-DD
  hours: number;
  sessions: number;
  avgScore: number;
}

export interface ComputedStats {
  totalSessions: number;
  totalHours: number;
  totalDurationMs: number;
  averageScore: number;
  currentStreak: number;
  longestStreak: number;
  topClients: { name: string; count: number }[];
  topTaskTypes: { name: string; count: number }[];
  byDay: DayBucket[];
  totalMilestones: number;
  avgDurationMinutes: number;
}

function sessionDate(s: Session): string {
  const d = new Date(s.endedAt ?? s.startedAt ?? Date.now());
  return d.toISOString().slice(0, 10);
}

function computeStreak(dates: Set<string>): { current: number; longest: number } {
  if (dates.size === 0) return { current: 0, longest: 0 };
  const sorted = [...dates].sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]!);
    const curr = new Date(sorted[i]!);
    const diff = (curr.getTime() - prev.getTime()) / 86400000;
    if (diff === 1) {
      run++;
      if (run > longest) longest = run;
    } else if (diff > 1) {
      run = 1;
    }
  }

  // current streak: walk backward from today
  const today = new Date().toISOString().slice(0, 10);
  let cur = 0;
  let check = today;
  while (dates.has(check)) {
    cur++;
    const d = new Date(check);
    d.setDate(d.getDate() - 1);
    check = d.toISOString().slice(0, 10);
  }

  return { current: cur, longest };
}

export function computeStats(sessions: Session[]): ComputedStats {
  if (sessions.length === 0) {
    return {
      totalSessions: 0,
      totalHours: 0,
      totalDurationMs: 0,
      averageScore: 0,
      currentStreak: 0,
      longestStreak: 0,
      topClients: [],
      topTaskTypes: [],
      byDay: [],
      totalMilestones: 0,
      avgDurationMinutes: 0,
    };
  }

  const totalDurationMs = sessions.reduce((s, x) => s + x.durationMs, 0);
  const scored = sessions.filter((s) => s.score != null);
  const averageScore =
    scored.length > 0 ? scored.reduce((s, x) => s + (x.score?.overall ?? 0), 0) / scored.length : 0;

  // Streak
  const dates = new Set(sessions.map(sessionDate));
  const { current, longest } = computeStreak(dates);

  // Top clients
  const clientCounts: Record<string, number> = {};
  for (const s of sessions) clientCounts[s.client] = (clientCounts[s.client] ?? 0) + 1;
  const topClients = Object.entries(clientCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  // Top task types
  const taskCounts: Record<string, number> = {};
  for (const s of sessions) taskCounts[s.taskType] = (taskCounts[s.taskType] ?? 0) + 1;
  const topTaskTypes = Object.entries(taskCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  // By day (last 30 days)
  const byDayMap: Record<string, { durationMs: number; sessions: number; scoreSum: number; scoreCount: number }> = {};
  for (const s of sessions) {
    const d = sessionDate(s);
    const bucket = byDayMap[d] ?? { durationMs: 0, sessions: 0, scoreSum: 0, scoreCount: 0 };
    bucket.durationMs += s.durationMs;
    bucket.sessions++;
    if (s.score) {
      bucket.scoreSum += s.score.overall;
      bucket.scoreCount++;
    }
    byDayMap[d] = bucket;
  }
  const byDay: DayBucket[] = Object.entries(byDayMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, b]) => ({
      date,
      hours: b.durationMs / 3600000,
      sessions: b.sessions,
      avgScore: b.scoreCount > 0 ? b.scoreSum / b.scoreCount : 0,
    }));

  const totalMilestones = sessions.reduce((s, x) => s + (x.milestones?.length ?? 0), 0);
  const avgDurationMinutes = totalDurationMs / sessions.length / 60000;

  return {
    totalSessions: sessions.length,
    totalHours: totalDurationMs / 3600000,
    totalDurationMs,
    averageScore,
    currentStreak: current,
    longestStreak: longest,
    topClients,
    topTaskTypes,
    byDay,
    totalMilestones,
    avgDurationMinutes,
  };
}

export function formatDuration(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatScore(score: number): string {
  return `${Math.round(score * 100)}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
