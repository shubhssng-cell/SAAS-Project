/**
 * The billing application layer's one error type (Phase 9 Unit 4, D-100). Every failure that leaves this package is one of
 * these: a stable `code`, a FIXED student-safe message and an HTTP status. A provider's text, a database error, a signature, a
 * secret or a payment reference is never copied into one.
 */
export type BillingApiErrorCode = "invalid_request" | "not_found" | "conflict" | "not_available" | "not_entitled" | "usage_limit_reached" | "invalid_webhook" | "infrastructure_failure";

export class BillingApiError extends Error {
  constructor(
    readonly code: BillingApiErrorCode,
    message: string,
    readonly httpStatus: number
  ) {
    super(message);
    this.name = "BillingApiError";
  }
}

export const invalidRequest = (message: string): BillingApiError => new BillingApiError("invalid_request", message, 400);
export const notAvailable = (message: string): BillingApiError => new BillingApiError("not_available", message, 503);

export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Refuses any key outside `allowed`, echoing only a short sanitized label of the offending key. */
export function requireOnlyKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw invalidRequest(`The field "${key.slice(0, 40).replace(/[^\w.-]/g, "?")}" is not accepted here.`);
  }
}

const DB_UNAVAILABLE_CODES = ["P1001", "P1002", "P1008", "P1017", "P2024"];

/** An unexpected store/service failure: the database being unreachable is a retryable 503; anything else is the fixed 500. The original message is never used. */
export function infrastructureError(error: unknown, message: string): BillingApiError {
  if (error instanceof BillingApiError) return error;
  const e = error as { name?: unknown; code?: unknown } | null;
  const unavailable = e?.name === "PrismaClientInitializationError" || (typeof e?.code === "string" && DB_UNAVAILABLE_CODES.includes(e.code));
  return unavailable ? new BillingApiError("not_available", "The service is temporarily unavailable. Please try again shortly.", 503) : new BillingApiError("infrastructure_failure", message, 500);
}

/** The verified identity of a student request. Derived from the session by the transport; never read from a request body. */
export interface BillingClaim {
  studentId: string;
  enrollmentId: string;
}

/** Resolves the exam a student's enrollment is for, or `null` if the enrollment is not theirs / does not exist. Server-side only. */
export type ExamScopeResolver = (studentId: string, enrollmentId: string) => Promise<string | null>;
