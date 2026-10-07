import { ExamDateRuleError } from "@ipmat/prep-phase";
import { EnrollmentApiError } from "./types.js";

/** The ONE place an unexpected error is turned into a safe, transport-agnostic `EnrollmentApiError`. Mirrors `@ipmat/auth-api`'s `toAuthApiError()`. */
/** Phase 9 Unit 3 (D-099): the database being unreachable or overloaded is a retryable 503, not a generic 500. Name/code only - never the message. */
function isDatabaseUnavailable(error: unknown): boolean {
  const e = error as { name?: unknown; code?: unknown } | null;
  return e?.name === "PrismaClientInitializationError" || (typeof e?.code === "string" && ["P1001", "P1002", "P1008", "P1017", "P2024"].includes(e.code));
}
const UNAVAILABLE_MESSAGE = "The service is temporarily unavailable. Please try again shortly.";

export function toEnrollmentApiError(error: unknown): EnrollmentApiError {
  if (isDatabaseUnavailable(error)) return new EnrollmentApiError("infrastructure_failure", UNAVAILABLE_MESSAGE, 503);
  if (error instanceof ExamDateRuleError) {
    // A malformed/unsupported exam date rule is a real infrastructure/seed-data
    // problem, never something the student did wrong.
    return new EnrollmentApiError("infrastructure_failure", "Your preparation timeline could not be calculated right now. Please try again.", 500);
  }
  return new EnrollmentApiError("infrastructure_failure", "An unexpected error occurred. Please try again.", 500);
}
