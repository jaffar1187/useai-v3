import { readSessionsForRange } from "@devness/useai-storage";
import type { Session } from "@devness/useai-types";
import { DAEMON_URL } from "@devness/useai-storage/paths";

export interface StatsData {
  totalSessions: number;
  totalHours: number;
  coveredHours: number;
  aiMultiplier: number;
  totalMilestones: number;
  currentStreak: number;
  completionRate: number;
  filesTouched: number;
  featuresShipped: number;
  bugsFixed: number;
  /** Clock-time seconds per client */
  byClient: Record<string, number>;
  /** AI-time seconds per client */
  byClientAI: Record<string, number>;
  /** Clock-time seconds per task type */
  byTaskType: Record<string, number>;
  /** AI-time seconds per task type */
  byTaskTypeAI: Record<string, number>;
  /** Clock-time seconds per project */
  byProject: Record<string, number>;
  /** Clock-time seconds per project (sweep-line) */
  byProjectClock: Record<string, number>;
  /** Clock-time seconds per language */
  byLanguage: Record<string, number>;
  /** AI-time seconds per language */
  byLanguageAI: Record<string, number>;
  /** Milestone complexity distribution */
  complexity: { simple: number; medium: number; complex: number };
  /** Evaluation averages (1-5 scale), null if no evaluated sessions */
  evaluation: {
    promptQuality: number;
    contextProvided: number;
    independenceLevel: number;
    scopeQuality: number;
  } | null;
}

export async function getStats(start: string, end: string): Promise<StatsData> {
  const params = new URLSearchParams({ start, end });

  const res = await fetch(`${DAEMON_URL}/api/local/aggregations?${params}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Daemon returned ${res.status}`);

  const json = await res.json() as {
    displaySessionCount: number;
    stats: {
      totalSessions: number;
      totalHours: number;
      coveredHours: number;
      aiMultiplier: number;
      totalMilestones: number;
      currentStreak: number;
      completionRate: number;
      filesTouched: number;
      featuresShipped: number;
      bugsFixed: number;
      byClient: Record<string, number>;
      byClientAI: Record<string, number>;
      byTaskType: Record<string, number>;
      byTaskTypeAI: Record<string, number>;
      byProject: Record<string, number>;
      byProjectClock: Record<string, number>;
      byLanguage: Record<string, number>;
      byLanguageAI: Record<string, number>;
    };
    complexity: { simple: number; medium: number; complex: number };
    evaluation: {
      promptQuality: number;
      contextProvided: number;
      independenceLevel: number;
      scopeQuality: number;
    } | null;
  };

  return {
    totalSessions: json.displaySessionCount,
    totalHours: json.stats.totalHours,
    coveredHours: json.stats.coveredHours,
    aiMultiplier: json.stats.aiMultiplier,
    totalMilestones: json.stats.totalMilestones,
    currentStreak: json.stats.currentStreak,
    completionRate: json.stats.completionRate,
    filesTouched: json.stats.filesTouched,
    featuresShipped: json.stats.featuresShipped,
    bugsFixed: json.stats.bugsFixed,
    byClient: json.stats.byClient,
    byClientAI: json.stats.byClientAI,
    byTaskType: json.stats.byTaskType,
    byTaskTypeAI: json.stats.byTaskTypeAI,
    byProject: json.stats.byProject,
    byProjectClock: json.stats.byProjectClock,
    byLanguage: json.stats.byLanguage,
    byLanguageAI: json.stats.byLanguageAI,
    complexity: json.complexity,
    evaluation: json.evaluation,
  };
}

/** Compute calendar-aligned time windows matching the dashboard */
export function getTimeWindow(scale: string): { start: string; end: string; label: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  switch (scale) {
    case "day":
      return {
        start: new Date(y, m, d).toISOString(),
        end: new Date(y, m, d + 1).toISOString(),
        label: "today",
      };
    case "week": {
      const dow = now.getDay() === 0 ? 6 : now.getDay() - 1;
      return {
        start: new Date(y, m, d - dow).toISOString(),
        end: new Date(y, m, d - dow + 7).toISOString(),
        label: "this week",
      };
    }
    case "month":
      return {
        start: new Date(y, m, 1).toISOString(),
        end: new Date(y, m + 1, 1).toISOString(),
        label: "this month",
      };
    case "year":
      return {
        start: new Date(y, 0, 1).toISOString(),
        end: new Date(y + 1, 0, 1).toISOString(),
        label: "this year",
      };
    default: {
      // Rolling: "7d", "30d", etc.
      const days = parseInt(scale, 10) || 7;
      return {
        start: new Date(Date.now() - days * 86400000).toISOString(),
        end: now.toISOString(),
        label: `last ${days} days`,
      };
    }
  }
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

