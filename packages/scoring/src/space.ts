import type { SessionScore, SessionEvaluation } from "@devness/useai-types";

/**
 * SPACE framework scoring for individual sessions.
 * Dimensions: Satisfaction, Performance, Activity, Communication, Efficiency
 * When an evaluation object is provided, its scores feed directly into the components.
 */
export function computeSpaceScore(params: {
  durationMs: number;
  taskType: string;
  evaluation?: SessionEvaluation;
}): SessionScore {
  const { durationMs, evaluation } = params;

  const outcomeMap = { completed: 1.0, partial: 0.6, blocked: 0.3, abandoned: 0.2 };
  const completed = !evaluation || evaluation.task_outcome === "completed";
  const partial = evaluation?.task_outcome === "partial";

  const satisfaction = evaluation
    ? (outcomeMap[evaluation.task_outcome] ?? 0.5)
    : (completed ? 0.8 : 0.3);

  const performance = computePerformance(durationMs, completed || partial);
  const activity = evaluation
    ? Math.min(1, 0.4 + evaluation.tools_leveraged * 0.06)
    : Math.min(1, durationMs / (60 * 60 * 1000));

  // Communication: derived from prompt_quality + context_provided (each 1-5 → 0-1)
  const communication = evaluation
    ? ((evaluation.prompt_quality + evaluation.context_provided) / 10)
    : 0.5;

  // Efficiency: derived from independence_level + scope_quality (each 1-5 → 0-1)
  const efficiency = evaluation
    ? ((evaluation.independence_level + evaluation.scope_quality) / 10)
    : computePerformance(durationMs, completed);

  const components: Record<string, number> = {
    satisfaction,
    performance,
    activity,
    communication,
    efficiency,
  };

  const overall =
    Object.values(components).reduce((a, b) => a + b, 0) /
    Object.keys(components).length;

  return { overall, components, framework: "space" };
}

function computePerformance(
  durationMs: number,
  completed: boolean,
): number {
  if (!completed) return 0.2;
  const minutes = durationMs / 60_000;
  if (minutes < 5) return 0.9;
  if (minutes < 30) return 0.7;
  if (minutes < 60) return 0.5;
  return 0.3;
}
