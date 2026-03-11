import type { SessionScore, SessionEvaluation } from "@devness/useai-types";

/**
 * Raw framework scoring — direct pass-through of evaluation fields with no
 * duration or task-type weighting. Produces a transparent 0-1 score purely
 * from what the AI reported in the evaluation object.
 *
 * Components (all normalized 0-1):
 *   promptQuality     — prompt_quality / 5
 *   contextProvided   — context_provided / 5
 *   taskOutcome       — mapped from task_outcome enum
 *   independenceLevel — independence_level / 5
 *   scopeQuality      — scope_quality / 5
 *   toolsLeveraged    — min(tools_leveraged / 10, 1)
 */

const OUTCOME_MAP: Record<string, number> = {
  completed: 1.0,
  partial: 0.6,
  blocked: 0.3,
  abandoned: 0.2,
};

export function computeRawScore(evaluation: SessionEvaluation): SessionScore {
  const components: Record<string, number> = {
    promptQuality: evaluation.prompt_quality / 5,
    contextProvided: evaluation.context_provided / 5,
    taskOutcome: OUTCOME_MAP[evaluation.task_outcome] ?? 0.5,
    independenceLevel: evaluation.independence_level / 5,
    scopeQuality: evaluation.scope_quality / 5,
    toolsLeveraged: Math.min(evaluation.tools_leveraged / 10, 1),
  };

  const overall =
    Object.values(components).reduce((a, b) => a + b, 0) /
    Object.keys(components).length;

  return { overall, components, framework: "raw" };
}
