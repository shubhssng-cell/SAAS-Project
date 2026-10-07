import { AttemptLifecycleError } from "@ipmat/attempt";
import { PersistenceError } from "@ipmat/db";
import { PracticeLoopError } from "@ipmat/practice-loop";
import { TrainingRecommendationError } from "@ipmat/training-recommendation";
import { TrainingSessionError } from "@ipmat/training-session";
import { PracticeApiError } from "./types.js";

/**
 * The ONE place a domain/application/repository error is turned into a
 * safe, transport-agnostic `PracticeApiError` (E). Every branch below maps
 * an EXISTING, already-thrown error type's `code` — this function never
 * inspects `error.message` to decide anything, and the `PracticeApiError`
 * it builds always carries a hand-authored, generic message, never the
 * original error's own text (which could otherwise echo back an internal
 * id, a repository's field name, or similar). An error type this function
 * does not recognize (a genuine, unexpected repository/infrastructure
 * failure — a real `PersistenceError` case, a network error, anything
 * else) maps to `infrastructure_failure`/500 with a fully generic message
 * — never a stack trace, never a raw driver/ORM error string. Logging the
 * ORIGINAL error server-side (for operators, never for the client) is a
 * transport's own job, not this function's.
 */
/** Phase 9 Unit 3 (D-099): the database being unreachable or overloaded is a retryable 503, not a generic 500. Name/code only - never the message. */
function isDatabaseUnavailable(error: unknown): boolean {
  const e = error as { name?: unknown; code?: unknown } | null;
  return e?.name === "PrismaClientInitializationError" || (typeof e?.code === "string" && ["P1001", "P1002", "P1008", "P1017", "P2024"].includes(e.code));
}
const UNAVAILABLE_MESSAGE = "The service is temporarily unavailable. Please try again shortly.";

export function toPracticeApiError(error: unknown): PracticeApiError {
  if (isDatabaseUnavailable(error)) return new PracticeApiError("infrastructure_failure", UNAVAILABLE_MESSAGE, 503);
  if (error instanceof TrainingRecommendationError) {
    switch (error.code) {
      case "invalid_request":
        return new PracticeApiError("invalid_request", "The request was missing a required identifier.", 400);
      case "enrollment_not_found":
        return new PracticeApiError("not_found", "No matching enrollment was found.", 404);
      case "enrollment_ownership_mismatch":
        return new PracticeApiError("ownership_mismatch", "This enrollment does not belong to the requesting student.", 403);
      case "ownership_inconsistency":
      case "repository_contract_violation":
        return new PracticeApiError("infrastructure_failure", "Your recommendation could not be computed right now. Please try again.", 500);
    }
  }

  if (error instanceof PracticeLoopError) {
    switch (error.code) {
      case "question_not_found":
      case "practice_block_not_found":
        return new PracticeApiError("not_found", "No matching question was found.", 404);
      case "question_not_published":
        return new PracticeApiError("question_not_published", "This question is not currently available for practice.", 409);
      case "practice_block_not_active":
        return new PracticeApiError("invalid_state", "This practice session is no longer active.", 409);
      case "practice_block_ownership_mismatch":
        return new PracticeApiError("ownership_mismatch", "This practice session does not belong to the requesting student.", 403);
    }
  }

  if (error instanceof TrainingSessionError) {
    switch (error.code) {
      case "invalid_config":
        return new PracticeApiError("invalid_request", "That session configuration is not allowed.", 400);
      case "unknown_system":
      case "session_not_found":
        return new PracticeApiError("not_found", "No matching training system or session was found.", 404);
      case "system_not_built":
        return new PracticeApiError("invalid_state", "This training system is not available yet.", 409);
      case "system_not_applicable":
        return new PracticeApiError("invalid_state", "Your recorded practice does not call for this training right now.", 409);
      case "no_eligible_question":
        return new PracticeApiError("invalid_state", "No published question fits this training right now.", 409);
      case "session_already_active":
        return new PracticeApiError("invalid_state", "Finish your current training session before starting another.", 409);
      case "session_not_active":
        return new PracticeApiError("invalid_state", "This training session has already ended.", 409);
      case "open_attempt_exists":
        return new PracticeApiError("invalid_state", "Answer or skip your open question before ending the session.", 409);
    }
  }

  if (error instanceof AttemptLifecycleError) {
    switch (error.code) {
      case "attempt_not_found":
        return new PracticeApiError("not_found", "No matching attempt was found.", 404);
      case "ownership_mismatch":
        return new PracticeApiError("ownership_mismatch", "This attempt does not belong to the requesting student.", 403);
      case "already_finalized":
        return new PracticeApiError("invalid_state", "This attempt has already been finalized.", 409);
      case "malformed_event_payload":
      case "impossible_timestamp":
      case "missing_answer":
      case "invalid_answer_option":
        return new PracticeApiError("invalid_request", "The request could not be applied to this attempt.", 400);
    }
  }

  if (error instanceof PersistenceError) {
    switch (error.code) {
      case "missing_reference":
        return new PracticeApiError("not_found", "A referenced record could not be found.", 404);
      case "ownership_mismatch":
        return new PracticeApiError("ownership_mismatch", "This record does not belong to the requesting student.", 403);
      case "conflict":
        return new PracticeApiError("invalid_state", "This request conflicts with the current state. Please try again.", 409);
      case "invalid_record":
        return new PracticeApiError("infrastructure_failure", "This request could not be completed right now. Please try again.", 500);
    }
  }

  return new PracticeApiError("infrastructure_failure", "An unexpected error occurred. Please try again.", 500);
}
