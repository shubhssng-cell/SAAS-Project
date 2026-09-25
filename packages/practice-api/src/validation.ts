import { PracticeApiError, type StudentRequestClaim } from "./types.js";

/**
 * Malformed-request rejection (H) — checked BEFORE any repository/service
 * call, so a blank/missing identifier never reaches a domain layer that
 * would otherwise treat it as "genuinely not found" (a different, less
 * accurate error). Every one of these throws `PracticeApiError` directly
 * (never wrapped by `toPracticeApiError()`, since it IS already the safe
 * shape) with `code: "invalid_request"`.
 */
export function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PracticeApiError("invalid_request", `"${field}" must be a non-empty string.`, 400);
  }
}

export function assertValidClaim(claim: StudentRequestClaim): void {
  assertNonEmptyString(claim.studentId, "studentId");
  assertNonEmptyString(claim.enrollmentId, "enrollmentId");
}
