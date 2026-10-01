export const TRAINING_SESSION_ERROR_CODES = [
  "invalid_config",
  "unknown_system",
  "system_not_built",
  "system_not_applicable",
  "no_eligible_question",
  "session_not_found",
  "session_not_active",
  "session_already_active",
  "open_attempt_exists"
] as const;
export type TrainingSessionErrorCode = (typeof TRAINING_SESSION_ERROR_CODES)[number];

/** Fail-closed error for this package's own rules -- the same shape as `PracticeBlockLifecycleError`/`AttemptLifecycleError`. */
export class TrainingSessionError extends Error {
  readonly code: TrainingSessionErrorCode;

  constructor(code: TrainingSessionErrorCode, message: string) {
    super(message);
    this.name = "TrainingSessionError";
    this.code = code;
  }
}
