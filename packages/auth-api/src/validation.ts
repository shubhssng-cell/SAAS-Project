import { AuthApiError } from "./types.js";

/** Malformed-request rejection, checked before any repository/service call — mirrors `@ipmat/practice-api`'s own `assertNonEmptyString()`. */
export function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AuthApiError("invalid_request", `"${field}" must be a non-empty string.`, 400);
  }
}
