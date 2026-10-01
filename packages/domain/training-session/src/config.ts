import { TrainingSessionError } from "./errors.js";

/**
 * Phase 5 Unit 1 -- session configuration. A session ends under exactly ONE explicit
 * completion rule (never a single hard-coded global rule; later units may add kinds).
 * Bounds are PROVISIONAL, authored limits that keep a session finite -- not calibrated
 * against any student outcome (the same honest caveat every named constant here carries).
 */
export const TRAINING_SESSION_BOUNDS = {
  MIN_QUESTION_COUNT: 1,
  MAX_QUESTION_COUNT: 20,
  MIN_DURATION_SECONDS: 60,
  MAX_DURATION_SECONDS: 3600
} as const;

export type TrainingSessionCompletion = { kind: "fixed_question_count"; questionCount: number } | { kind: "fixed_duration"; durationSeconds: number };

export interface TrainingSessionConfig {
  completion: TrainingSessionCompletion;
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Validates UNTRUSTED input (an HTTP body, or a persisted JSON column) into a typed config,
 * or throws `TrainingSessionError("invalid_config")`. Unknown completion kinds and unknown
 * extra keys are rejected -- nothing is coerced, defaulted or silently dropped.
 */
export function validateTrainingSessionConfig(input: unknown): TrainingSessionConfig {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TrainingSessionError("invalid_config", "The session configuration must be an object.");
  }
  const config = input as Record<string, unknown>;
  const keys = Object.keys(config);
  if (keys.length !== 1 || keys[0] !== "completion") {
    throw new TrainingSessionError("invalid_config", "The session configuration must contain exactly one field: completion.");
  }
  const completion = config.completion;
  if (typeof completion !== "object" || completion === null || Array.isArray(completion)) {
    throw new TrainingSessionError("invalid_config", "completion must be an object.");
  }
  const rule = completion as Record<string, unknown>;

  if (rule.kind === "fixed_question_count") {
    if (Object.keys(rule).length !== 2 || !isIntegerInRange(rule.questionCount, TRAINING_SESSION_BOUNDS.MIN_QUESTION_COUNT, TRAINING_SESSION_BOUNDS.MAX_QUESTION_COUNT)) {
      throw new TrainingSessionError(
        "invalid_config",
        `questionCount must be a whole number from ${TRAINING_SESSION_BOUNDS.MIN_QUESTION_COUNT} to ${TRAINING_SESSION_BOUNDS.MAX_QUESTION_COUNT}.`
      );
    }
    return { completion: { kind: "fixed_question_count", questionCount: rule.questionCount } };
  }

  if (rule.kind === "fixed_duration") {
    if (Object.keys(rule).length !== 2 || !isIntegerInRange(rule.durationSeconds, TRAINING_SESSION_BOUNDS.MIN_DURATION_SECONDS, TRAINING_SESSION_BOUNDS.MAX_DURATION_SECONDS)) {
      throw new TrainingSessionError(
        "invalid_config",
        `durationSeconds must be a whole number from ${TRAINING_SESSION_BOUNDS.MIN_DURATION_SECONDS} to ${TRAINING_SESSION_BOUNDS.MAX_DURATION_SECONDS}.`
      );
    }
    return { completion: { kind: "fixed_duration", durationSeconds: rule.durationSeconds } };
  }

  throw new TrainingSessionError("invalid_config", "completion.kind must be fixed_question_count or fixed_duration.");
}

/**
 * The `PracticeBlock` columns a config maps onto. The block (D-060) is the persisted
 * lifecycle/attempt container; the config's completion rule is stored there as its
 * existing `targetQuestionCount` / `blockTimeBudgetSeconds`, never duplicated.
 */
export function toBlockSettings(config: TrainingSessionConfig): { targetQuestionCount: number | null; blockTimeBudgetSeconds: number | null } {
  return config.completion.kind === "fixed_question_count"
    ? { targetQuestionCount: config.completion.questionCount, blockTimeBudgetSeconds: null }
    : { targetQuestionCount: null, blockTimeBudgetSeconds: config.completion.durationSeconds };
}
