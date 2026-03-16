import type { SessionScore, SessionEvaluation } from "@devness/useai-types";

/**
 * Calibrated framework scoring — adds gap analysis to reduce score inflation.
 *
 * For each scored field, the AI can provide an `*_ideal` string explaining what
 * would make it perfect. The score factors in consistency between the actual
 * score and the ideal explanation, making inflated scores harder.
 *
 * Components (weighted):
 *   taskOutcome       (0.30) — mapped from task_outcome enum
 *   promptQuality     (0.15) — prompt_quality / 5, consistency-adjusted
 *   contextProvided   (0.15) — context_provided / 5, consistency-adjusted
 *   independenceLevel (0.10) — independence_level / 5, consistency-adjusted
 *   scopeQuality      (0.10) — scope_quality / 5, consistency-adjusted
 *   selfAwareness     (0.20) — ratio of justified gaps to total gaps
 */

const OUTCOME_MAP: Record<string, number> = {
  completed: 1.0,
  partial: 0.6,
  blocked: 0.3,
  abandoned: 0.2,
};

interface FieldCheck {
  score: number;
  ideal: string | undefined;
}

function consistencyMultiplier(field: FieldCheck): number {
  if (field.score >= 5 && field.ideal) return 0.8; // contradictory
  if (field.score < 5 && !field.ideal) return 0.7; // unjustified gap
  return 1.0; // consistent
}

function computeSelfAwareness(fields: FieldCheck[]): number {
  let justified = 0;
  let unjustified = 0;

  for (const f of fields) {
    if (f.score < 5 && f.ideal) justified++;
    if (f.score < 5 && !f.ideal) unjustified++;
  }

  if (justified + unjustified === 0) return 0.5; // all perfect — neutral
  return justified / (justified + unjustified);
}

export function computeCalibratedScore(
  evaluation: SessionEvaluation,
): SessionScore {
  const promptField: FieldCheck = { score: evaluation.prompt_quality, ideal: evaluation.prompt_quality_ideal };
  const contextField: FieldCheck = { score: evaluation.context_provided, ideal: evaluation.context_provided_ideal };
  const independenceField: FieldCheck = { score: evaluation.independence_level, ideal: evaluation.independence_level_ideal };
  const scopeField: FieldCheck = { score: evaluation.scope_quality, ideal: evaluation.scope_quality_ideal };

  const taskOutcome = OUTCOME_MAP[evaluation.task_outcome] ?? 0.5;
  const promptQuality =
    (evaluation.prompt_quality / 5) * consistencyMultiplier(promptField);
  const contextProvided =
    (evaluation.context_provided / 5) * consistencyMultiplier(contextField);
  const independenceLevel =
    (evaluation.independence_level / 5) * consistencyMultiplier(independenceField);
  const scopeQuality =
    (evaluation.scope_quality / 5) * consistencyMultiplier(scopeField);

  // task_outcome_ideal feeds into self-awareness but doesn't adjust taskOutcome weight
  const allFields: FieldCheck[] = [
    promptField,
    contextField,
    independenceField,
    scopeField,
    {
      score: evaluation.task_outcome === "completed" ? 5 : 1,
      ideal: evaluation.task_outcome_ideal,
    },
  ];
  const selfAwareness = computeSelfAwareness(allFields);

  const components: Record<string, number> = {
    taskOutcome,
    promptQuality,
    contextProvided,
    independenceLevel,
    scopeQuality,
    selfAwareness,
  };

  const overall =
    taskOutcome * 0.3 +
    promptQuality * 0.15 +
    contextProvided * 0.15 +
    independenceLevel * 0.1 +
    scopeQuality * 0.1 +
    selfAwareness * 0.2;

  return { overall, components, framework: "calibrated" };
}
