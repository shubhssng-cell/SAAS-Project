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
export function toAuthApiError(error: unknown): AuthApiError {
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
