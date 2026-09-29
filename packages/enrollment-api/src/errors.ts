import { ExamDateRuleError } from "@ipmat/prep-phase";
import { EnrollmentApiError } from "./types.js";

/** The ONE place an unexpected error is turned into a safe, transport-agnostic `EnrollmentApiError`. Mirrors `@ipmat/auth-api`'s `toAuthApiError()`. */
export function toEnrollmentApiError(error: unknown): EnrollmentApiError {
  if (error instanceof ExamDateRuleError) {
    // A malformed/unsupported exam date rule is a real infrastructure/seed-data
    // problem, never something the student did wrong.
    return new EnrollmentApiError("infrastructure_failure", "Your preparation timeline could not be calculated right now. Please try again.", 500);
  }
  return new EnrollmentApiError("infrastructure_failure", "An unexpected error occurred. Please try again.", 500);
}
