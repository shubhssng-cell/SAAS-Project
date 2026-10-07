import { AuthValidationError } from "@ipmat/auth";
import { PersistenceError } from "@ipmat/db";
import { AuthApiError } from "./types.js";

/**
 * The ONE place a domain/repository error is turned into a safe,
 * transport-agnostic `AuthApiError` -- mirrors `@ipmat/practice-api`'s own
 * `toPracticeApiError()`. Never inspects `error.message` to decide
 * anything; the `AuthApiError` it builds always carries a hand-authored,
 * generic message, never the original error's own text.
 */
/** Phase 9 Unit 3 (D-099): the database being unreachable or overloaded is a retryable 503, not a generic 500. Name/code only - never the message. */
function isDatabaseUnavailable(error: unknown): boolean {
  const e = error as { name?: unknown; code?: unknown } | null;
  return e?.name === "PrismaClientInitializationError" || (typeof e?.code === "string" && ["P1001", "P1002", "P1008", "P1017", "P2024"].includes(e.code));
}
const UNAVAILABLE_MESSAGE = "The service is temporarily unavailable. Please try again shortly.";

export function toAuthApiError(error: unknown): AuthApiError {
  if (isDatabaseUnavailable(error)) return new AuthApiError("infrastructure_failure", UNAVAILABLE_MESSAGE, 503);
  if (error instanceof AuthValidationError) {
    return new AuthApiError("invalid_request", error.message, 400);
  }

  if (error instanceof PersistenceError) {
    switch (error.code) {
      case "invalid_record":
        return new AuthApiError("email_already_registered", "An account with this email already exists.", 409);
      case "missing_reference":
      case "ownership_mismatch":
        return new AuthApiError("infrastructure_failure", "This request could not be completed right now. Please try again.", 500);
    }
  }

  return new AuthApiError("infrastructure_failure", "An unexpected error occurred. Please try again.", 500);
}
