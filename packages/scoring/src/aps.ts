import type { Session } from "@devness/useai-types";

export interface APSComponents {
  output: number;
  efficiency: number;
  promptQuality: number;
  consistency: number;
  breadth: number;
}

export interface APSResult {
  score: number;
  components: APSComponents;
}

const WEIGHTS: Record<keyof APSComponents, number> = {
  output: 0.25,
  efficiency: 0.25,
  promptQuality: 0.2,
  consistency: 0.15,
  breadth: 0.15,
};

/**
 * Compute AI Proficiency Score (0-1000) from a set of sessions.
 */
export function computeAPS(sessions: Session[]): APSResult {
  if (sessions.length === 0) {
    return {
      score: 0,
      components: {
        output: 0,
        efficiency: 0,
        promptQuality: 0,
        consistency: 0,
        breadth: 0,
      },
    };
  }

  const components: APSComponents = {
    output: computeOutput(sessions),
    efficiency: computeEfficiency(sessions),
    promptQuality: computePromptQuality(sessions),
    consistency: computeConsistency(sessions),
    breadth: computeBreadth(sessions),
  };

  const score = Math.round(
    Object.entries(WEIGHTS).reduce(
      (sum, [key, weight]) =>
        sum + components[key as keyof APSComponents] * weight,
      0,
    ) * 1000,
  );

  return { score, components };
}

function computeOutput(sessions: Session[]): number {
  const scored = sessions.filter((s) => s.score);
  if (scored.length === 0) return 0;
  const avg =
    scored.reduce((sum, s) => sum + (s.score?.overall ?? 0), 0) / scored.length;
  return Math.min(1, avg);
}

function computeEfficiency(sessions: Session[]): number {
  const avgDuration =
    sessions.reduce((s, x) => s + x.durationMs, 0) / sessions.length;
  const targetMs = 30 * 60 * 1000; // 30 min target
  return Math.min(1, targetMs / Math.max(avgDuration, 1));
}

function computePromptQuality(sessions: Session[]): number {
  const scored = sessions.filter((s) => s.score?.components?.["promptQuality"]);
  if (scored.length === 0) return 0.5;
  return (
    scored.reduce(
      (sum, s) => sum + (s.score!.components["promptQuality"] ?? 0),
      0,
    ) / scored.length
  );
}

function computeConsistency(sessions: Session[]): number {
  if (sessions.length < 2) return 0.5;
  const days = new Set(
    sessions.map((s) => {
      const d = new Date(s.startedAt);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }),
  );
  return Math.min(1, days.size / 30);
}

function computeBreadth(sessions: Session[]): number {
  const clients = new Set(sessions.map((s) => s.client));
  const taskTypes = new Set(sessions.map((s) => s.taskType));
  return Math.min(1, (clients.size + taskTypes.size) / 10);
}
