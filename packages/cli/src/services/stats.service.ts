import { readSessionsForRange } from "@devness/useai-storage";
import type { Session } from "@devness/useai-types";
import { DAEMON_URL } from "@devness/useai-storage/paths";

export interface StatsData {
  totalSessions: number;
  totalDurationMs: number;
  averageScore: number;
  currentStreak: number;
  longestStreak: number;
  sessionsByClient: Record<string, number>;
  sessionsByTaskType: Record<string, number>;
}

export async function getStats(days = 30): Promise<StatsData> {
  // Try daemon first
  try {
    const res = await fetch(`${DAEMON_URL}/api/local/stats`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const json = await res.json() as { data: StatsData };
      return json.data;
    }
  } catch { /* fall through to local */ }

  // Local fallback
  const sessions = await readSessionsForRange(days);
  return computeStats(sessions);
}

export async function getSessions(days = 30): Promise<Session[]> {
  try {
    const res = await fetch(`${DAEMON_URL}/api/local/sessions?days=${days}`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const json = await res.json() as { data: { sessions: Session[] } };
      return json.data.sessions;
    }
  } catch { /* fall through */ }
  return readSessionsForRange(days);
}

function computeStats(sessions: Session[]): StatsData {
  const totalDurationMs = sessions.reduce((s, x) => s + x.durationMs, 0);
  const scored = sessions.filter((s) => s.score);
  const averageScore = scored.length > 0
    ? scored.reduce((s, x) => s + (x.score?.overall ?? 0), 0) / scored.length
    : 0;

  const sessionsByClient: Record<string, number> = {};
  const sessionsByTaskType: Record<string, number> = {};
  for (const s of sessions) {
    sessionsByClient[s.client] = (sessionsByClient[s.client] ?? 0) + 1;
    sessionsByTaskType[s.taskType] = (sessionsByTaskType[s.taskType] ?? 0) + 1;
  }

  const { current, longest } = computeStreak(sessions);

  return {
    totalSessions: sessions.length,
    totalDurationMs,
    averageScore,
    currentStreak: current,
    longestStreak: longest,
    sessionsByClient,
    sessionsByTaskType,
  };
}

function computeStreak(sessions: Session[]): { current: number; longest: number } {
  const days = new Set(sessions.map((s) => s.endedAt.slice(0, 10)));
  const sorted = Array.from(days).sort().reverse();
  let current = 0;
  let longest = 0;
  let streak = 0;
  let prevDate: Date | null = null;

  for (const day of sorted) {
    const d = new Date(day);
    if (prevDate === null || (prevDate.getTime() - d.getTime()) === 86_400_000) {
      streak++;
    } else {
      longest = Math.max(longest, streak);
      streak = 1;
    }
    prevDate = d;
  }
  longest = Math.max(longest, streak);

  // current streak: consecutive days ending today or yesterday
  const today = new Date().toISOString().slice(0, 10);
  if (sorted[0] === today || sorted[0] === new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)) {
    let s = 0;
    let prev: Date | null = null;
    for (const day of sorted) {
      const d = new Date(day);
      if (prev === null || (prev.getTime() - d.getTime()) === 86_400_000) {
        s++;
      } else break;
      prev = d;
    }
    current = s;
  }

  return { current, longest };
}
